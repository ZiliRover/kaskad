"use client";

import { BRAND } from "@/config/brand";
import { isActive, useStudio } from "./store";

export function TopBar({ graphName, providerMode }: { graphName: string; providerMode: "live" | "mock" }) {
  const run = useStudio((s) => s.run);
  const modelIds = useStudio((s) => s.nodes.filter((n) => n.type === "model").map((n) => n.id).join(","));
  const anyBusy = useStudio((s) =>
    Object.keys(s.submitting).length > 0 || Object.keys(s.state).some((id) => isActive(s.state, id)));

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
          <span
            className="badge badge-warn"
            title="Генерации не настоящие и бесплатные. Для реальных: PROVIDER_MODE=live в .env"
          >Тестовый режим</span>
        )}
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
