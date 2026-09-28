"use client";

import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { PlusIcon, StopIcon } from "@phosphor-icons/react";
import { memo, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { fanOut } from "@/lib/graph/plan";
import type { GraphDoc } from "@/lib/graph/types";
import { estimate } from "@/lib/models/pricing";
import { formatKop, formatRub, priceTitle, toKop } from "@/lib/money";
import { getModel, isBlocked, TOOL_PREFIX } from "@/lib/models/registry";
import type { MediaKind, ParamValue } from "@/lib/models/types";
import { isActive, useStudio, type ModelNodeT } from "../store";
import { NodeShell } from "./NodeShell";
import { ParamField } from "./ParamField";
import { ResultView } from "./ResultView";

const KIND_LABEL: Record<MediaKind, string> = { image: "Картинка", video: "Видео", text: "Текст" };

/** The node still has the model and settings of its last run, so that run's price is the price. */
function sameSettings(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return false;
  return true;
}

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

export const ModelNode = memo(function ModelNode({ id, data, selected }: NodeProps<ModelNodeT>) {
  const spec = getModel(data.modelId);
  const { updateData, run, cancel, addPromptFor } = useStudio(useShallow((s) => ({
    updateData: s.updateData, run: s.run, cancel: s.cancel, addPromptFor: s.addPromptFor,
  })));
  const isTool = data.modelId.startsWith(TOOL_PREFIX);
  const blocked = useStudio((s) => isBlocked(data.modelId, s.blockedVendors));
  const fx = useStudio((s) => s.fx);
  const node = useStudio((s) => s.state[id]);
  const active = useStudio((s) => isActive(s.state, id));
  const submitting = useStudio((s) => !!s.submitting[id]);
  const localError = useStudio((s) => s.localErrors[id]);
  const wired = useStudio(useShallow((s) => s.edges.filter((e) => e.target === id).map((e) => e.targetHandle ?? "")));
  // prompt length drives the price of text models; a model's text output counts as a typical prompt
  const promptChars = useStudio((s) => s.edges
    .filter((e) => e.target === id && e.targetHandle === "prompt")
    .reduce((sum, e) => {
      const src = s.nodes.find((n) => n.id === e.source);
      return sum + (src?.type === "prompt" ? src.data.text.length : 400);
    }, 0));

  // fed by a list: runs once per item
  const fan = useStudio((s) => fanOut({ nodes: s.nodes as unknown as GraphDoc["nodes"], edges: s.edges as GraphDoc["edges"] }).get(id) ?? 0);
  const busy = active || submitting;
  const job = node?.job;
  const elapsed = useElapsed(job?.startedAt, job?.status === "running");

  const counts: Record<string, number> = {};
  for (const h of wired) counts[h] = (counts[h] ?? 0) + 1;

  // handles move when the model (its ports) or the layout above them changes
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => { updateInternals(id); }, [id, data.modelId, updateInternals]);

  const setParam = (key: string, v: ParamValue) =>
    updateData<ModelNodeT>(id, { params: { ...data.params, [key]: v } });

  const est = spec ? estimate(spec, { params: data.params, inputCounts: counts, promptChars }) : null;

  // after a successful run the node shows what it actually cost, until its settings change
  const finalKop = job?.status === "succeeded"
    ? job.chargedKop ?? (job.costUsd !== null ? toKop(job.costUsd, fx) : null)
    : null;
  const showFinal = finalKop !== null && job!.modelId === data.modelId && sameSettings(job!.params, data.params);

  let status: { text: string; tone?: "error" | "ok" } | null = null;
  if (localError) status = { text: localError, tone: "error" };
  else if (submitting) status = { text: "Отправляю…" };
  else if (job?.status === "queued") status = { text: job.items ? `В очереди: ${job.items.total} шт.` : "В очереди" };
  else if (job?.status === "running") {
    const verb = isTool ? "Обработка" : "Генерация";
    status = job.items
      ? { text: `${verb}: готово ${job.items.done} из ${job.items.total}` }
      : { text: elapsed ? `${verb} ${elapsed}` : `${verb}…` };
  }
  else if (job?.status === "succeeded" && job.items && job.items.done < job.items.total) {
    status = { text: `Готово ${job.items.done} из ${job.items.total}. ${job.error ?? ""}`.trim(), tone: "error" };
  }
  else if (job?.status === "failed" || job?.status === "skipped") status = { text: job.error ?? "Ошибка", tone: "error" };
  else if (job?.status === "canceled") status = { text: "Остановлено" };
  else if (job?.status === "succeeded") {
    // settings changed since: the price slot shows the next run's estimate, so name the old cost here
    status = { text: finalKop !== null && !showFinal ? `Готово, ${formatKop(finalKop)}` : "Готово", tone: "ok" };
  }

  const footer = (
    <div className="node-foot">
      {busy ? (
        <button
          type="button"
          className="btn btn-sm nodrag"
          disabled={submitting}
          onClick={() => cancel(id)}
          title="Остановить генерацию"
        >
          <StopIcon size={12} weight="fill" aria-hidden />
          Стоп
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-sm nodrag" disabled={!spec || blocked} onClick={() => run([id], "missing")}>
          Запустить
        </button>
      )}
      {status && (
        <span className={`node-status${status.tone ? ` is-${status.tone}` : ""}`} title={status.text}>{status.text}</span>
      )}
      {isTool ? (
        <span className="node-price" title="Выполняется на нашем сервере">бесплатно</span>
      ) : showFinal ? (
        <span className="node-price is-final" title="Итоговая стоимость последнего запуска">{formatKop(finalKop!)}</span>
      ) : est && est.usd !== null && (
        <span className="node-price" title={fan ? `${fan} запусков по ${formatRub(est.usd, fx)}. ${priceTitle(est.usd * fan, fx)}` : `Оценка запуска: ${priceTitle(est.usd, fx)}`}>
          {fan ? <span className="node-fan">×{fan}</span> : null}{est.approx ? "≈ " : ""}{formatRub(est.usd * (fan || 1), fx)}
        </span>
      )}
    </div>
  );

  return (
    <NodeShell
      id={id}
      title={spec?.name ?? "Модель недоступна"}
      subtitle={isTool ? "инструмент" : `${KIND_LABEL[data.kind]}, ${spec?.vendor ?? ""}`}
      hint={isTool ? undefined : "Чтобы сменить модель, перетащи другую из панели прямо на эту ноду"}
      icon={isTool ? "tool" : `model:${data.kind}`}
      dtype={data.kind}
      selected={selected}
      busy={busy}
      phase={job?.status === "running" ? "running" : job?.status === "queued" || submitting ? "queued" : null}
      wide
      footer={footer}
    >
      {blocked && (
        <div className="node-warning">
          {spec?.vendor} не обслуживает регион сервера. Перетащи на эту ноду модель другого производителя.
        </div>
      )}

      {spec && (
        <div className="ports">
          {spec.inputs.map((p) => {
            const n = counts[p.key] ?? 0;
            const needed = n < p.min;
            const meta = n
              ? (p.max > 1 ? `${n} из ${p.max}` : "подключено")
              : needed ? "обязательно"
                : [p.hint, p.max > 1 ? `до ${p.max}` : null].filter(Boolean).join(", ") || "необязательно";
            const addPrompt = p.key === "prompt" && !n;
            return (
              <div className={`port-row${n ? " is-wired" : ""}${needed ? " is-needed" : ""}`} key={p.key}>
                <Handle type="target" position={Position.Left} id={p.key} className={`handle handle-${p.dtype}`} />
                <span className="port-label">{p.label}</span>
                {addPrompt ? (
                  <button
                    type="button" className="port-add nodrag"
                    title="Добавить ноду «Промт» и подключить сюда"
                    onClick={() => addPromptFor(id)}
                  >
                    <PlusIcon size={11} weight="bold" aria-hidden />{spec.promptOptional ? `${p.label.toLowerCase()}, если нужен` : `добавить ${p.label.toLowerCase()}`}
                  </button>
                ) : (
                  <span className="port-meta">{meta}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {spec && spec.params.length > 0 && (
        <div className="params">
          {spec.params.map((p) => (
            <ParamField key={p.key} spec={p} value={data.params[p.key]} onChange={(v) => setParam(p.key, v)} />
          ))}
        </div>
      )}

      <ResultView
        nodeId={id}
        kind={data.kind}
        node={node}
        busy={busy}
        aspect={String(data.params.aspect_ratio ?? "")}
        pinnedId={data.pinnedOutputId}
      />
    </NodeShell>
  );
});
