"use client";

import { ImagesSquareIcon, LayoutIcon, MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { BRAND } from "@/config/brand";
import { isActive, useStudio } from "./store";
import { useTheme, type ThemeMode } from "./theme";

const THEME_NEXT: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemeMode, string> = { system: "Тема как в системе", light: "Светлая тема", dark: "Тёмная тема" };
const THEME_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

export function TopBar({ graphName, providerMode }: { graphName: string; providerMode: "live" | "mock" }) {
  const run = useStudio((s) => s.run);
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
        <span className="graph-name">{graphName}</span>
      </div>
      <div className="tb-right">
        {providerMode === "mock" && (
          <span className="badge badge-warn" title="Генерации не настоящие и бесплатные. Для реальных: PROVIDER_MODE=live в .env">
            Тестовый режим
          </span>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => setPanel({ templatesOpen: true })}>
          <LayoutIcon size={15} aria-hidden />Шаблоны
        </button>
        <button
          type="button"
          className={`btn btn-ghost${galleryOpen ? " is-on" : ""}`}
          aria-pressed={galleryOpen}
          onClick={() => setPanel({ galleryOpen: !galleryOpen })}
        >
          <ImagesSquareIcon size={15} aria-hidden />Результаты
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
          className="btn btn-primary"
          disabled={!modelIds || anyBusy}
          onClick={() => run(modelIds.split(","), "all")}
        >Запустить всё</button>
      </div>
    </header>
  );
}
