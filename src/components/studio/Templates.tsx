"use client";

import { ArrowRightIcon, XIcon } from "@phosphor-icons/react";
import { useReactFlow } from "@xyflow/react";
import { Fragment, useEffect } from "react";
import { outputHandle, type GraphNode } from "@/lib/graph/types";
import { getModel } from "@/lib/models/registry";
import { TEMPLATES, templateChain } from "@/lib/templates";
import { NodeIcon, type NodeKey } from "./icons";
import { useStudio } from "./store";

export function iconFor(n: GraphNode): NodeKey {
  if (n.type === "prompt") return "prompt";
  if (n.type === "image") return `upload:${n.data.kind ?? "image"}`;
  if (n.type === "model") return n.data.modelId.startsWith("kaskad/") ? "tool" : `model:${n.data.kind}`;
  if (n.type === "list") return "list";
  if (n.type === "asset") return "asset";
  return n.type;
}

export function nodeLabel(n: GraphNode): string {
  if (n.type === "prompt") return "Промт";
  if (n.type === "image") return n.data.kind === "video" ? "Видео" : n.data.kind === "audio" ? "Аудио" : "Фото";
  if (n.type === "model") return getModel(n.data.modelId)?.name ?? n.data.modelId;
  if (n.type === "list") return "Список";
  if (n.type === "asset") return n.data.name;
  return "";
}

export function Templates() {
  const open = useStudio((s) => s.templatesOpen);
  const setPanel = useStudio((s) => s.setPanel);
  const insert = useStudio((s) => s.insertTemplate);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPanel({ templatesOpen: false }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setPanel]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPanel({ templatesOpen: false }); }}>
      <div className="dialog templates" role="dialog" aria-modal="true" aria-labelledby="tpl-title">
        <div className="templates-head">
          <h2 id="tpl-title" className="dialog-title">Шаблоны</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={() => setPanel({ templatesOpen: false })}>
            <XIcon size={14} weight="bold" aria-hidden />
          </button>
        </div>
        <p className="dialog-body">Готовые цепочки. Добавятся рядом с тем, что уже есть на холсте: подставь свои файлы и тексты.</p>
        <div className="templates-grid">
          {TEMPLATES.map((t) => {
            const chain = templateChain(t);
            return (
              <article key={t.id} className="tpl">
                <span className="tpl-audience">{t.audience}</span>
                <h3 className="tpl-title">{t.title}</h3>
                <p className="tpl-desc">{t.description}</p>
                <div className="tpl-chain" aria-label="Цепочка нод">
                  {chain.map((n, i) => (
                    <Fragment key={n.id}>
                      {i > 0 && <ArrowRightIcon size={10} className="tpl-arrow" aria-hidden />}
                      <span className="tpl-step" title={nodeLabel(n)}>
                        <NodeIcon node={iconFor(n)} dtype={outputHandle(n)} size={13} />
                        <span>{nodeLabel(n)}</span>
                      </span>
                    </Fragment>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm tpl-add"
                  onClick={() => {
                    const ids = insert(t);
                    setPanel({ templatesOpen: false });
                    // show the new chain once React Flow has measured it
                    setTimeout(() => fitView({ nodes: ids.map((id) => ({ id })), padding: 0.2, duration: 400 }), 80);
                  }}
                >Добавить на холст</button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
