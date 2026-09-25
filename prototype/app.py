"""Seedance Studio - node-based desktop client for OpenRouter media models."""
import json
import os
import re
import shutil
import sys
import threading
import time
from pathlib import Path

import requests
import webview

# Frozen (PyInstaller) build: exe dir is read-only territory (Program Files),
# so web assets, outputs and settings live under %LOCALAPPDATA%\SeedanceStudio.
FROZEN = getattr(sys, "frozen", False)
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))

if FROZEN:
    DATA_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "SeedanceStudio"
    WEB_DIR = DATA_DIR / "web"
    SETTINGS_FILE = DATA_DIR / "settings.json"
else:
    WEB_DIR = APP_DIR / "web"
    SETTINGS_FILE = APP_DIR / "settings.json"

OUTPUT_DIR = WEB_DIR / "outputs"

OR_BASE = "https://openrouter.ai/api/v1"
HTTP_TIMEOUT = 60
VIDEO_DEADLINE_SEC = 20 * 60


def load_env():
    env = {}
    env_path = APP_DIR / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                env[m.group(1)] = m.group(2)
    return env


ENV = load_env()


def read_settings():
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_settings(patch):
    data = read_settings()
    data.update(patch)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


class Api:
    def __init__(self):
        self._window = None
        self._models_cache = None
        self._lock = threading.Lock()

    # ---------- settings / keys ----------

    def _key(self):
        return read_settings().get("openrouter_key") or ENV.get("OPENROUTER_API_KEY") or ""

    def _headers(self):
        return {
            "Authorization": f"Bearer {self._key()}",
            "Content-Type": "application/json",
            "X-Title": "Seedance Studio",
        }

    def get_settings(self):
        s = read_settings()
        key = self._key()
        return {
            "has_key": bool(key),
            "key_preview": (key[:14] + "..." + key[-4:]) if key else "",
            "spend_total": s.get("spend_total", 0.0),
        }

    def save_key(self, key):
        write_settings({"openrouter_key": key.strip()})
        return self.get_settings()

    def add_spend(self, amount):
        with self._lock:
            s = read_settings()
            total = float(s.get("spend_total", 0.0)) + float(amount or 0.0)
            write_settings({"spend_total": round(total, 6)})
            return {"spend_total": round(total, 6)}

    def get_credits(self):
        if not self._key():
            return {"error": "no_key"}
        try:
            r = requests.get(f"{OR_BASE}/credits", headers=self._headers(), timeout=HTTP_TIMEOUT)
            d = r.json().get("data", {})
            balance = float(d.get("total_credits", 0)) - float(d.get("total_usage", 0))
            return {"balance": round(balance, 4)}
        except Exception as e:
            return {"error": str(e)}

    # ---------- model catalog ----------

    def video_models(self):
        if self._models_cache:
            return self._models_cache
        try:
            r = requests.get(f"{OR_BASE}/videos/models", timeout=HTTP_TIMEOUT)
            r.raise_for_status()
            payload = r.json()
            items = payload.get("data", payload) or []
            models = []
            for m in items:
                if not str(m.get("id", "")).startswith("bytedance/"):
                    continue
                models.append({
                    "id": m["id"],
                    "name": m.get("name", m["id"]).replace("ByteDance: ", ""),
                    "resolutions": m.get("supported_resolutions") or ["720p"],
                    "aspect_ratios": m.get("supported_aspect_ratios") or ["16:9"],
                    "durations": m.get("supported_durations") or [5],
                    "audio": bool(m.get("generate_audio")),
                    "pricing": m.get("pricing_skus") or {},
                })
            if models:
                order = ["seedance-2.5", "seedance-2.0", "seedance-2.0-fast", "seedance-2.0-mini", "seedance-1-5-pro"]
                models.sort(key=lambda m: next((i for i, o in enumerate(order) if o in m["id"]), 99))
                self._models_cache = models
                return models
        except Exception:
            pass
        return []  # frontend falls back to its bundled catalog

    # ---------- generation ----------

    def generate_video(self, params):
        """params: {model, prompt, resolution, aspect_ratio, duration, generate_audio,
                    seed, first_frame, last_frame} (frames are data URLs)"""
        if not self._key():
            return {"error": "Нет ключа OpenRouter. Добавь его в настройках."}
        body = {
            "model": params["model"],
            "prompt": params.get("prompt", ""),
        }
        for k in ("resolution", "aspect_ratio"):
            if params.get(k):
                body[k] = params[k]
        if params.get("duration"):
            body["duration"] = int(params["duration"])
        if params.get("generate_audio") is not None:
            body["generate_audio"] = bool(params["generate_audio"])
        if params.get("seed"):
            try:
                body["seed"] = int(params["seed"])
            except ValueError:
                pass
        frames = []
        if params.get("first_frame"):
            frames.append({"type": "image_url", "image_url": {"url": params["first_frame"]},
                           "frame_type": "first_frame"})
        if params.get("last_frame"):
            frames.append({"type": "image_url", "image_url": {"url": params["last_frame"]},
                           "frame_type": "last_frame"})
        if frames:
            body["frame_images"] = frames

        try:
            r = requests.post(f"{OR_BASE}/videos", headers=self._headers(),
                              json=body, timeout=HTTP_TIMEOUT)
            job = r.json() if r.content else {}
            if r.status_code >= 400 or not job.get("id"):
                msg = self._err_msg(job) or f"HTTP {r.status_code}"
                return {"error": f"OpenRouter: {msg}"}
        except Exception as e:
            return {"error": f"Сеть: {e}"}

        poll_url = job.get("polling_url") or f"{OR_BASE}/videos/{job['id']}"
        deadline = time.time() + VIDEO_DEADLINE_SEC
        status = {}
        while time.time() < deadline:
            time.sleep(4)
            try:
                pr = requests.get(poll_url, headers=self._headers(), timeout=HTTP_TIMEOUT)
                status = pr.json()
            except Exception:
                continue
            st = status.get("status")
            if st == "completed":
                break
            if st in ("failed", "cancelled", "expired"):
                return {"error": f"Генерация не удалась: {self._err_msg(status) or st}"}
        else:
            return {"error": "Таймаут: генерация шла дольше 20 минут."}

        urls = status.get("unsigned_urls") or []
        if not urls:
            return {"error": "Готово, но OpenRouter не вернул ссылку на видео."}
        try:
            vr = requests.get(urls[0], headers={"Authorization": f"Bearer {self._key()}"},
                              timeout=300)
            vr.raise_for_status()
        except Exception as e:
            return {"error": f"Не удалось скачать видео: {e}"}

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        fname = f"seedance-{int(time.time())}.mp4"
        (OUTPUT_DIR / fname).write_bytes(vr.content)
        cost = (status.get("usage") or {}).get("cost", 0) or 0
        return {
            "file": f"outputs/{fname}",
            "abs_path": str(OUTPUT_DIR / fname),
            "cost": float(cost),
        }

    def chat(self, payload):
        """Chat completions passthrough for LLM and image-gen nodes. Returns text/images/cost."""
        if not self._key():
            return {"error": "Нет ключа OpenRouter. Добавь его в настройках."}
        payload = dict(payload)
        payload["usage"] = {"include": True}
        try:
            r = requests.post(f"{OR_BASE}/chat/completions", headers=self._headers(),
                              json=payload, timeout=600)
            data = r.json() if r.content else {}
            if r.status_code >= 400:
                return {"error": f"OpenRouter: {self._err_msg(data) or f'HTTP {r.status_code}'}"}
            msg = (data.get("choices") or [{}])[0].get("message", {})
            images = [img.get("image_url", {}).get("url")
                      for img in (msg.get("images") or []) if img.get("image_url")]
            cost = (data.get("usage") or {}).get("cost", 0) or 0
            return {"text": msg.get("content") or "", "images": images, "cost": float(cost)}
        except Exception as e:
            return {"error": f"Сеть: {e}"}

    @staticmethod
    def _err_msg(data):
        if not isinstance(data, dict):
            return None
        err = data.get("error")
        if isinstance(err, dict):
            return err.get("message")
        if isinstance(err, str):
            return err
        return data.get("message") or data.get("detail")

    # ---------- files / window ----------

    def export_file(self, args):
        """args: {data_url?} or {path?}, suggested"""
        try:
            dest = self._window.create_file_dialog(
                webview.SAVE_DIALOG, save_filename=args.get("suggested", "output"))
            if not dest:
                return {"canceled": True}
            dest = dest if isinstance(dest, str) else dest[0]
            if args.get("data_url"):
                m = re.match(r"^data:([^;]+);base64,(.*)$", args["data_url"], re.S)
                if not m:
                    return {"error": "Неподдерживаемый формат данных."}
                import base64
                Path(dest).write_bytes(base64.b64decode(m.group(2)))
            elif args.get("path"):
                Path(dest).write_bytes(Path(args["path"]).read_bytes())
            else:
                return {"error": "Нечего сохранять."}
            return {"saved": dest}
        except Exception as e:
            return {"error": str(e)}

    def win_minimize(self):
        self._window.minimize()

    def win_toggle_max(self):
        try:
            if getattr(self, "_maximized", False):
                self._window.restore()
                self._maximized = False
            else:
                self._window.maximize()
                self._maximized = True
        except AttributeError:
            self._window.toggle_fullscreen()

    def win_close(self):
        self._window.destroy()


def main():
    if FROZEN:
        # sync bundled web assets into the writable data dir (keeps outputs/)
        WEB_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copytree(BUNDLE_DIR / "web", WEB_DIR, dirs_exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    api = Api()
    window = webview.create_window(
        "Seedance Studio",
        str(WEB_DIR / "index.html"),
        js_api=api,
        width=1500,
        height=940,
        min_size=(1100, 700),
        background_color="#0e0f12",
        frameless=True,
        easy_drag=False,
    )
    api._window = window
    webview.start(private_mode=False)


if __name__ == "__main__":
    main()
