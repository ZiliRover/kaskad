"use client";

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { formatKop, formatUsd } from "@/lib/money";
import { getModel } from "@/lib/models/registry";
import { authLost, useStudio } from "./store";

const PACKS = [300, 1000, 3000];
const MIN_RUB = 100, MAX_RUB = 100_000;

interface Entry { id: string; kind: "topup" | "bonus" | "charge" | "adjust"; amountKop: number; note: string | null; createdAt: string }

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function entryLabel(e: Entry): string {
  if (e.kind === "topup") return "Пополнение";
  if (e.kind === "bonus") return e.note ?? "Бонус";
  if (e.kind === "charge") return e.note ? (getModel(e.note)?.name ?? e.note) : "Генерация";
  return e.note ?? "Корректировка";
}

export function Billing() {
  const open = useStudio((s) => s.billingOpen);
  const account = useStudio((s) => s.account);
  const fx = useStudio((s) => s.fx);
  const setPanel = useStudio((s) => s.setPanel);
  const [history, setHistory] = useState<Entry[] | null>(null);
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => setPanel({ billingOpen: false });

  useEffect(() => {
    if (!open) return;
    setError(null);
    let alive = true;
    fetch("/api/billing", { cache: "no-store" })
      .then((r) => (authLost(r) ? null : r.json()))
      .then((b) => {
        if (!alive || !b) return;
        setHistory(b.history);
        const acc = useStudio.getState().account;
        if (acc) useStudio.setState({ account: { ...acc, availableKop: b.balanceKop, reservedKop: b.reservedKop } });
      })
      .catch(() => { if (alive) setHistory([]); });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => { alive = false; window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !account) return null;

  const rub = Number(amount.replace(/\s/g, "").replace(",", "."));
  const valid = Number.isFinite(rub) && rub >= MIN_RUB && rub <= MAX_RUB;

  const pay = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/payments", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountRub: rub }),
      });
      if (authLost(r)) return;
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Не удалось создать платёж");
      window.location.assign(data.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog billing" role="dialog" aria-modal="true" aria-labelledby="billing-title">
        <div className="templates-head">
          <h2 id="billing-title" className="dialog-title">Баланс</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={close}>
            <XIcon size={14} weight="bold" aria-hidden />
          </button>
        </div>

        {account.admin && (
          <div className="billing-balance">
            <span className="auth-label">OpenRouter</span>
            <span className="billing-amount">
              {account.providerUsd === null ? "—" : formatKop(Math.round(account.providerUsd * fx.usdRub) * 100)}
            </span>
            <span className="billing-reserved">
              {account.providerUsd === null ? "Не удалось получить баланс OpenRouter." : `${formatUsd(account.providerUsd)} по курсу ЦБ. `}
              Ты администратор: генерации идут без лимита и не списываются с баланса сайта.
              Этот блок видят только администраторы.
            </span>
          </div>
        )}

        <div className="billing-balance">
          {account.admin && <span className="auth-label">Баланс на сайте</span>}
          <span className={`billing-amount${account.availableKop < 0 ? " is-negative" : ""}`}>{formatKop(account.availableKop)}</span>
          {account.reservedKop > 0 && (
            <span className="billing-reserved">
              ещё {formatKop(account.reservedKop)} в резерве: спишется по факту, когда генерации закончатся
            </span>
          )}
        </div>

        {account.payments ? (
          <form className="billing-topup" onSubmit={(e) => { e.preventDefault(); if (valid) void pay(); }}>
            <span className="auth-label">Пополнить</span>
            <div className="billing-packs" role="group" aria-label="Сумма пополнения">
              {PACKS.map((p) => (
                <button
                  key={p} type="button" className={`chip${rub === p ? " is-on" : ""}`} aria-pressed={rub === p}
                  onClick={() => setAmount(String(p))}
                >{formatKop(p * 100)}</button>
              ))}
              <label className="billing-custom">
                <input
                  className="field" inputMode="decimal" aria-label="Своя сумма в рублях"
                  value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d\s.,]/g, ""))}
                />
                <span aria-hidden>₽</span>
              </label>
            </div>
            {!valid && amount && <p className="auth-error">Сумма от {formatKop(MIN_RUB * 100)} до {formatKop(MAX_RUB * 100)}</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              {busy ? "Переходим к оплате…" : valid ? `Пополнить на ${formatKop(Math.round(rub * 100))}` : "Пополнить"}
            </button>
            {account.payments === "test" && (
              <p className="billing-hint">Платежи в тестовом режиме: деньги не списываются.</p>
            )}
          </form>
        ) : (
          <p className="dialog-body">Пополнение пока недоступно.</p>
        )}

        <p className="billing-hint">
          Списываем фактическую стоимость генерации. Если генерация не удалась, деньги не списываются.
        </p>

        <div className="billing-history">
          <span className="auth-label">История</span>
          {history === null ? (
            <p className="billing-hint">Загружаем…</p>
          ) : history.length === 0 ? (
            <p className="billing-hint">Пока пусто. Здесь появятся пополнения и списания за генерации.</p>
          ) : (
            <ul>
              {history.map((e) => (
                <li key={e.id}>
                  <span className="bh-label">{entryLabel(e)}</span>
                  <span className="bh-date">{dateFmt.format(new Date(e.createdAt))}</span>
                  <span className={`bh-amount${e.amountKop > 0 ? " is-plus" : ""}`}>
                    {e.amountKop > 0 ? "+" : "−"}{formatKop(Math.abs(e.amountKop))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
