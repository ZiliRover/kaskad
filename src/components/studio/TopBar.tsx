"use client";

import {
  ImagesSquareIcon, LayoutIcon, MonitorIcon, MoonIcon, SignOutIcon, SunIcon, UserIcon, WalletIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/config/brand";
import { formatKop, formatUsd } from "@/lib/money";
import type { ProjectSummary } from "@/lib/projects";
import { Agent } from "./Agent";
import { Projects } from "./Projects";
import { isActive, useStudio } from "./store";
import { useTheme, type ThemeMode } from "./theme";

const THEME_NEXT: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemeMode, string> = { system: "Тема как в системе", light: "Светлая тема", dark: "Тёмная тема" };
const THEME_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

function AccountMenu() {
  const account = useStudio((s) => s.account);
  const fx = useStudio((s) => s.fx);
  const setPanel = useStudio((s) => s.setPanel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  if (!account) return null;
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  };

  return (
    <>
      {account.admin ? (
        // operators spend the provider account directly: that is their balance
        <button
          type="button"
          className="btn btn-ghost balance-chip"
          title={account.providerUsd === null
            ? "Баланс OpenRouter недоступен (нет ключа или сети)"
            : `${formatUsd(account.providerUsd)} на счёте OpenRouter, по курсу ЦБ. Генерации администратора идут без лимита и не списываются с баланса сайта, цены на нодах показаны без наценки, как у провайдера. Этот баланс видят только администраторы.`}
          onClick={() => setPanel({ billingOpen: true })}
        >
          <WalletIcon size={15} aria-hidden />
          <span className="balance-tag">OpenRouter</span>
          {account.providerUsd === null ? "—" : formatKop(Math.round(account.providerUsd * fx.usdRub) * 100)}
        </button>
      ) : (
        <button
          type="button"
          className={`btn btn-ghost balance-chip${account.availableKop <= 0 ? " is-empty" : ""}`}
          title={account.reservedKop > 0 ? `Ещё ${formatKop(account.reservedKop)} в резерве у идущих генераций` : "Баланс и пополнение"}
          onClick={() => setPanel({ billingOpen: true })}
        >
          <WalletIcon size={15} aria-hidden />{formatKop(Math.max(0, account.availableKop))}
        </button>
      )}
      <div className="enhance" ref={ref}>
        <button
          type="button" className="icon-btn tb-icon" aria-label="Аккаунт" aria-haspopup="menu" aria-expanded={open}
          title={account.email} onClick={() => setOpen((v) => !v)}
        >
          <UserIcon size={16} aria-hidden />
        </button>
        {open && (
          <div className="menu account-menu" role="menu">
            <span className="account-email">{account.email}</span>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setPanel({ billingOpen: true }); }}>
              <WalletIcon size={14} aria-hidden />Баланс и история
            </button>
            <button type="button" role="menuitem" onClick={() => void logout()}>
              <SignOutIcon size={14} aria-hidden />Выйти
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function TopBar({ graphId, graphName, projects, providerMode }: {
  graphId: string; graphName: string; projects: ProjectSummary[]; providerMode: "live" | "mock";
}) {
  const run = useStudio((s) => s.run);
  const draft = useStudio((s) => s.draft);
  const setDraft = useStudio((s) => s.setDraft);
  const setPanel = useStudio((s) => s.setPanel);
  const galleryOpen = useStudio((s) => s.galleryOpen);
  const modelIds = useStudio((s) => s.nodes.filter((n) => n.type === "model").map((n) => n.id).join(","));
  const anyBusy = useStudio((s) =>
    Object.keys(s.submitting).length > 0 || Object.keys(s.state).some((id) => isActive(s.state, id)));
  const { mode, setMode } = useTheme();
  const ThemeIcon = THEME_ICON[mode];

  return (
    <header className="topbar">
      <div className="tb-left">
        <span className="logo" aria-hidden />
        <span className="brand">{BRAND.name}</span>
        <span className="tb-sep" aria-hidden>/</span>
        <Projects currentId={graphId} initialName={graphName} initial={projects} />
      </div>
      <div className="tb-right">
        {providerMode === "mock" && (
          <span className="badge badge-warn" title="Провайдер не вызывается: вместо генераций заглушки, баланс списывается по оценке. Для реальных: PROVIDER_MODE=live в .env">
            Тестовый режим
          </span>
        )}
        <Agent />
        <button type="button" className="btn btn-ghost" aria-label="Шаблоны" title="Шаблоны" onClick={() => setPanel({ templatesOpen: true })}>
          <LayoutIcon size={15} aria-hidden /><span className="tb-label">Шаблоны</span>
        </button>
        <button
          type="button"
          className={`btn btn-ghost${galleryOpen ? " is-on" : ""}`}
          aria-pressed={galleryOpen}
          aria-label="Медиатека"
          title="Результаты и загрузки всех проектов"
          onClick={() => setPanel({ galleryOpen: !galleryOpen })}
        >
          <ImagesSquareIcon size={15} aria-hidden /><span className="tb-label">Медиатека</span>
        </button>
        <button
          type="button"
          className="icon-btn tb-icon"
          aria-label={`${THEME_LABEL[mode]}. Нажми, чтобы сменить`}
          title={THEME_LABEL[mode]}
          onClick={() => setMode(THEME_NEXT[mode])}
        >
          <ThemeIcon size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={`btn btn-ghost draft-toggle${draft ? " is-on" : ""}`}
          aria-pressed={draft}
          title={draft
            ? "Черновик включён: 480p, низкое качество, без звука видео. Выключи и перезапусти, чтобы сделать финал"
            : "Черновик: проверить идею дёшево, на минимальных настройках всех моделей"}
          onClick={() => setDraft(!draft)}
        >
          <span className="draft-dot" aria-hidden />Черновик
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!modelIds || anyBusy}
          onClick={() => run(modelIds.split(","), "all")}
        >Запустить всё</button>
        <span className="tb-divider" aria-hidden />
        <AccountMenu />
      </div>
    </header>
  );
}
