"use client";

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import type { NodeProps } from "@xyflow/react";
import { memo, useRef, useState } from "react";
import { LIST_MAX, listItems } from "@/lib/graph/types";
import { useStudio, type ListNodeT } from "../store";
import { ACCEPT_ATTR, fileUrl, mediaFiles, uploadFile, type UploadKind } from "../upload";
import { NodeShell } from "./NodeShell";

const FILE_WORDS: Record<UploadKind, [string, string, string]> = {
  image: ["картинка", "картинки", "картинок"],
  video: ["видео", "видео", "видео"],
  audio: ["аудио", "аудио", "аудио"],
};

function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10, m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
}

/**
 * A batch: a model fed by this node runs once per line (or per file),
 * and the chain after it continues item by item.
 */
export const ListNode = memo(function ListNode({ id, data, selected }: NodeProps<ListNodeT>) {
  const updateData = useStudio((s) => s.updateData);
  const toast = useStudio((s) => s.toast);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);
  const count = listItems(data).length;

  if (data.kind === "text") {
    return (
      <NodeShell
        id={id} title="Список промтов" subtitle={plural(count, ["строка", "строки", "строк"])}
        hint="Модель запустится по разу на каждую строку" icon="list" dtype="text" selected={selected}
      >
        <textarea
          className="field nodrag nowheel list-text"
          rows={7}
          value={data.text ?? ""}
          placeholder={"Каждая строка: отдельный запуск\nКрасная кроссовка на белом фоне\nСиняя кроссовка на белом фоне"}
          onChange={(e) => updateData<ListNodeT>(id, { text: e.target.value })}
        />
        <p className="list-hint">{count > LIST_MAX ? `Возьмутся первые ${LIST_MAX} строк` : "Подключи к модели: она сработает на каждую строку"}</p>
      </NodeShell>
    );
  }

  const files = data.files ?? [];
  const kind = data.kind;

  async function add(list: File[]) {
    const room = LIST_MAX - files.length;
    if (!list.length) return;
    if (room <= 0) { toast(`В списке до ${LIST_MAX} файлов`, true); return; }
    const take = list.slice(0, room);
    setBusy(take.length);
    const keys: string[] = [];
    let listKind = files.length ? kind : null;
    for (const f of take) {
      try {
        const r = await uploadFile(f);
        listKind ??= r.kind; // an empty list takes the kind of its first file
        if (r.kind !== listKind) { toast(`${f.name}: в этом списке только ${FILE_WORDS[listKind][2]}`, true); continue; }
        keys.push(r.key);
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`, true);
      } finally {
        setBusy((b) => b - 1);
      }
    }
    // read the latest state: other uploads may have landed meanwhile
    const cur = useStudio.getState().nodes.find((n) => n.id === id);
    const now = cur?.type === "list" ? cur.data.files ?? [] : files;
    if (keys.length) updateData<ListNodeT>(id, { kind: listKind ?? kind, files: [...now, ...keys].slice(0, LIST_MAX) });
    if (list.length > room) toast(`Добавлено ${room}: в списке до ${LIST_MAX} файлов`, true);
  }

  const remove = (key: string) => updateData<ListNodeT>(id, { files: files.filter((k) => k !== key) });
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(false); void add(mediaFiles(e.dataTransfer.files)); },
  };

  return (
    <NodeShell
      id={id} title="Список файлов" subtitle={files.length ? plural(files.length, FILE_WORDS[kind]) : "пусто"}
      hint="Модель запустится по разу на каждый файл" icon="list" dtype={kind} selected={selected} busy={busy > 0}
    >
      <div className={`list-grid nodrag nowheel${over ? " is-over" : ""}`} {...dropProps}>
        {files.map((key, i) => (
          <div key={key} className="list-cell">
            {kind === "image"
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={fileUrl(key)} alt={`Файл ${i + 1}`} loading="lazy" />
              : kind === "video"
                ? <video src={`${fileUrl(key)}#t=0.1`} muted preload="metadata" />
                : <span className="list-audio">{i + 1}</span>}
            <span className="list-index">{i + 1}</span>
            <button type="button" className="list-remove" aria-label={`Убрать файл ${i + 1}`} onClick={() => remove(key)}>
              <XIcon size={10} weight="bold" aria-hidden />
            </button>
          </div>
        ))}
        {files.length < LIST_MAX && (
          <button type="button" className="list-add" onClick={() => input.current?.click()} disabled={busy > 0}>
            {busy > 0 ? <span>Загружаю {busy}…</span> : <><PlusIcon size={14} aria-hidden /><span>Добавить</span></>}
          </button>
        )}
      </div>
      <p className="list-hint">{files.length ? "Модель сработает на каждый файл" : "Перетащи сюда несколько файлов или нажми «Добавить»"}</p>
      <input
        ref={input} type="file" accept={ACCEPT_ATTR} multiple hidden
        onChange={(e) => { void add(mediaFiles(e.target.files)); e.target.value = ""; }}
      />
    </NodeShell>
  );
});
