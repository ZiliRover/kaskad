"use client";

import { ArrowLeftIcon, ArrowRightIcon, GiftIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/config/brand";
import { formatKop } from "@/lib/money";
import { AuthStage } from "./AuthStage";

const RESEND_SEC = 30;

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Сервер не ответил. Попробуйте ещё раз.");
  return data;
}

export function LoginForm({ bonusKop, next = "/studio" }: { bonusKop: number; next?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const sendCode = async () => {
    setBusy(true); setError(null);
    try {
      const r = await post("/api/auth/request-code", { email });
      setDevCode(r.devCode ?? null);
      setStep("code"); setCode(""); setWait(RESEND_SEC);
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try {
      await post("/api/auth/verify", { email, code: value });
      window.location.replace(next);
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

          {step === "email" ? (
            <form key="email" className="auth-form signin-step" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
              <h1 className="signin-title">Создавай из одного кадра</h1>
              <p className="auth-sub">Картинки, видео и карточки товаров на лучших моделях мира. Вход по коду из письма, без пароля.</p>
              <label className="auth-label" htmlFor="email">Почта</label>
              <input
                id="email" className="field auth-field" type="email" inputMode="email" autoComplete="email"
                placeholder="you@example.ru" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              />
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary auth-submit signin-go" disabled={busy || !email.trim()}>
                {busy ? "Отправляем…" : <>Получить код<ArrowRightIcon size={15} weight="bold" aria-hidden /></>}
              </button>
              {bonusKop > 0 && (
                <p className="signin-bonus"><GiftIcon size={14} aria-hidden />{formatKop(bonusKop)} на первые генерации новым аккаунтам</p>
              )}
              <p className="auth-legal">
                Продолжая, вы принимаете <a href="/terms" target="_blank" rel="noreferrer">условия использования</a> и
                соглашаетесь на обработку данных по <a href="/privacy" target="_blank" rel="noreferrer">политике конфиденциальности</a>.
              </p>
            </form>
          ) : (
            <form key="code" className="auth-form signin-step" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
              <button type="button" className="link-btn auth-back" onClick={() => { setStep("email"); setError(null); }}>
                <ArrowLeftIcon size={12} aria-hidden />Другая почта
              </button>
              <h1 className="signin-title">Код из письма</h1>
              <p className="auth-sub">Отправили на <b>{email.trim().toLowerCase()}</b>. Код действует 10 минут.</p>
              <label className="auth-label" htmlFor="code">6 цифр</label>
              <div className={`code-cells${error ? " is-error" : ""}`} onClick={() => codeRef.current?.focus()}>
                <input
                  id="code" ref={codeRef} className="code-input" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={6} value={code} aria-describedby={error ? "code-error" : undefined}
                  onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setCode(v);
                    if (v.length === 6) void verify(v); // paste or autofill signs in at once
                  }}
                />
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} aria-hidden
                    className={`code-cell${code[i] ? " is-filled" : ""}${focused && i === Math.min(code.length, 5) ? " is-active" : ""}`}>
                    {code[i] ?? ""}
                  </span>
                ))}
              </div>
              {devCode && (
                <p className="auth-dev">Почта не настроена (SMTP_URL), код для разработки: <b>{devCode}</b></p>
              )}
              {error && <p id="code-error" className="auth-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary auth-submit signin-go" disabled={busy || code.length !== 6}>
                {busy ? "Входим…" : <>Войти<ArrowRightIcon size={15} weight="bold" aria-hidden /></>}
              </button>
              <button type="button" className="link-btn auth-resend" disabled={wait > 0 || busy} onClick={() => void sendCode()}>
                {wait > 0 ? `Отправить ещё раз через ${wait} с` : "Отправить код ещё раз"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
