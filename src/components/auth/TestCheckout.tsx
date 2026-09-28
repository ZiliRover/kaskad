"use client";

import { useState } from "react";
import { BRAND } from "@/config/brand";
import { formatKop } from "@/lib/money";

/** What the bank's page will be. Here nothing is charged: the balance is credited on the spot. */
export function TestCheckout({ id, amountKop, email }: { id: string; amountKop: number; email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (action: "pay" | "cancel") => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/payments/${id}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error();
      window.location.replace(`/studio?payment=${id}`);
    } catch {
      setError("Не получилось. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand"><span className="logo" aria-hidden /><span className="brand">{BRAND.name}</span></div>
        <div className="auth-form">
          <span className="badge badge-warn auth-badge">Тестовая оплата</span>
          <h1 className="auth-title">Пополнение на {formatKop(amountKop)}</h1>
          <p className="auth-sub">
            Здесь будет страница банка. Сейчас платежи в тестовом режиме: деньги не списываются,
            баланс {email} пополнится сразу.
          </p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="button" className="btn btn-primary auth-submit" disabled={busy} onClick={() => void finish("pay")}>
            Оплатить {formatKop(amountKop)}
          </button>
          <button type="button" className="link-btn auth-resend" disabled={busy} onClick={() => void finish("cancel")}>
            Отменить платёж
          </button>
        </div>
      </div>
    </main>
  );
}
