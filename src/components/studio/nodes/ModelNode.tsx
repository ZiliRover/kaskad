"use client";

import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { estimate, formatUsd } from "@/lib/models/pricing";
import { getModel } from "@/lib/models/registry";
import type { MediaKind, ParamValue } from "@/lib/models/types";
import { isActive, useStudio, type ModelNodeT } from "../store";
import { ModelPicker } from "./ModelPicker";
import { NodeShell } from "./NodeShell";
import { ParamField } from "./ParamField";
import { ResultView } from "./ResultView";

const TITLES: Record<MediaKind, string> = { image: "Генерация картинки", video: "Генерация видео", text: "Текст · AI" };
const PROMPT_HINT: Record<MediaKind, string> = {
  image: "Что изобразить: объект, стиль, свет, композиция",
  video: "Что происходит в кадре и как движется камера",
  text: "Задача для модели, например «Придумай 3 идеи для рекламы кофе»",
};

function useElapsed(since: string | null | undefined, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  if (!on || !since) return null;
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ModelNode({ id, data, selected }: NodeProps<ModelNodeT>) {
  const spec = getModel(data.modelId);
  const { updateData, setModel, run } = useStudio(useShallow((s) => ({ updateData: s.updateData, setModel: s.setModel, run: s.run })));
  const node = useStudio((s) => s.state[id]);
  const active = useStudio((s) => isActive(s.state, id));
  const submitting = useStudio((s) => !!s.submitting[id]);
  const localError = useStudio((s) => s.localErrors[id]);
  const wired = useStudio(useShallow((s) => s.edges.filter((e) => e.target === id).map((e) => e.targetHandle ?? "")));

  const busy = active || submitting;
  const job = node?.job;
  const elapsed = useElapsed(job?.startedAt, job?.status === "running");

  const counts: Record<string, number> = {};
  for (const h of wired) counts[h] = (counts[h] ?? 0) + 1;
  const promptWired = (counts.prompt ?? 0) > 0;

  // handles move when the model (its ports) or the layout above them changes
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => { updateInternals(id); }, [id, data.modelId, promptWired, updateInternals]);

  const setParam = (key: string, v: ParamValue) =>
    updateData<ModelNodeT>(id, { params: { ...data.params, [key]: v } });

  const est = spec ? estimate(spec, { params: data.params, inputCounts: counts, promptChars: data.prompt.length }) : null;

  let status: { text: string; tone?: "error" | "ok" } | null = null;
  if (localError) status = { text: localError, tone: "error" };
  else if (submitting) status = { text: "Отправка…" };
  else if (job?.status === "queued") status = { text: "В очереди" };
  else if (job?.status === "running") status = { text: `Генерация${elapsed ? ` · ${elapsed}` : "…"}` };
  else if (job?.status === "failed" || job?.status === "skipped") status = { text: job.error ?? "Ошибка", tone: "error" };
  else if (job?.status === "succeeded") {
    status = { text: `Готово${job.costUsd !== null ? ` · ${formatUsd(job.costUsd)}` : ""}`, tone: "ok" };
  }

  const footer = (
    <div className="node-foot">
      <button
        type="button"
        className="btn btn-primary btn-sm nodrag"
        disabled={busy || !spec}
        onClick={() => run([id], "missing")}
      >
        {busy ? <span className="spinner" aria-hidden /> : null}
        {busy ? "Идёт" : "Запустить"}
      </button>
      {status && (
        <span className={`node-status${status.tone ? ` is-${status.tone}` : ""}`} title={status.text}>{status.text}</span>
      )}
      {est && est.usd !== null && (
        <span className="node-price" title="Оценка стоимости запуска">{est.approx ? "≈" : ""}{formatUsd(est.usd)}</span>
      )}
    </div>
  );

  return (
    <NodeShell id={id} title={TITLES[data.kind]} dtype={data.kind} selected={selected} busy={busy} wide footer={footer}>
      <ModelPicker kind={data.kind} value={data.modelId} onChange={(m) => setModel(id, m)} />

      {spec && (
        <div className="ports">
          {spec.inputs.map((p) => {
            const n = counts[p.key] ?? 0;
            const meta = n
              ? (p.max > 1 ? `${n} из ${p.max}` : "подключено")
              : p.key === "prompt" ? "или напиши ниже" : p.max > 1 ? `до ${p.max}` : "необязательно";
            return (
              <div className={`port-row${n ? " is-wired" : ""}`} key={p.key}>
                <Handle type="target" position={Position.Left} id={p.key} className={`handle handle-${p.dtype}`} />
                <span className="port-label">{p.label}</span>
                <span className="port-meta">{meta}</span>
              </div>
            );
          })}
        </div>
      )}

      {!promptWired && (
        <textarea
          className="field nodrag nowheel"
          rows={3}
          value={data.prompt}
          placeholder={PROMPT_HINT[data.kind]}
          onChange={(e) => updateData<ModelNodeT>(id, { prompt: e.target.value })}
        />
      )}

      {spec && spec.params.length > 0 && (
        <div className="params">
          {spec.params.map((p) => (
            <ParamField key={p.key} spec={p} value={data.params[p.key]} onChange={(v) => setParam(p.key, v)} />
          ))}
        </div>
      )}

      <ResultView kind={data.kind} node={node} busy={busy} aspect={String(data.params.aspect_ratio ?? "")} />
    </NodeShell>
  );
}
