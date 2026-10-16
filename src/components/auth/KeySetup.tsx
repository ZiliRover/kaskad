"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { BRAND } from "@/config/brand";
import { AuthStage } from "./AuthStage";

/** Desktop app: the person's own OpenRouter key, asked before anything else works. */
export function KeySetup({ hasKey }: { hasKey: boolean }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/desktop/key", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Не удалось сохранить ключ");
      window.location.assign("/studio");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <AuthStage />
      <div className="signin-panel">
        <div className="signin-card">
          <div className="auth-brand"><span className="logo" aria-hidden /><span className="brand">{BRAND.name}</span></div>
          <form className="auth-form signin-step" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <h1 className="signin-title">{hasKey ? "Сменить ключ OpenRouter" : "Ключ OpenRouter"}</h1>
            <p className="auth-sub">
              Генерации идут через ваш аккаунт OpenRouter и оплачиваются с него. Цены в Каскаде — в рублях по курсу ЦБ,
              как у провайдера. Ключ хранится только на этом компьютере.
            </p>
            <label className="auth-label" htmlFor="or-key">Ключ</label>
            <input
              id="or-key" className="field auth-field" type="password" autoComplete="off" spellCheck={false}
              placeholder="sk-or-v1-…" value={key} onChange={(e) => setKey(e.target.value)} autoFocus
            />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary auth-submit signin-go" disabled={busy || key.trim().length < 20}>
              {busy ? "Проверяем ключ…" : <>Сохранить и начать<ArrowRightIcon size={15} aria-hidden /></>}
            </button>
            <p className="auth-legal">
              Где взять: <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a> → Create Key.
              Пополнить счёт: <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">openrouter.ai/settings/credits</a>.
              {hasKey && <> <a href="/studio">Вернуться без изменений</a>.</>}
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
