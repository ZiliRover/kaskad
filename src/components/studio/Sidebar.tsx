"use client";

import { useReactFlow } from "@xyflow/react";
import { modelsOfKind } from "@/lib/models/registry";
import type { MediaKind } from "@/lib/models/types";
import { PALETTE_MIME } from "./Canvas";
import { useStudio, type StudioNode } from "./store";

interface Item { type: StudioNode["type"]; kind?: MediaKind; title: string; desc: string; dot: MediaKind }

const examples = (kind: MediaKind) => modelsOfKind(kind).slice(0, 3).map((m) => m.name).join(", ");

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Входные данные",
    items: [
      { type: "prompt", title: "Промт", desc: "Текст для моделей", dot: "text" },
      { type: "image", title: "Изображение", desc: "Своя картинка или фото", dot: "image" },
    ],
  },
  {
    title: "Генерация",
    items: [
      { type: "model", kind: "image", title: "Картинка", desc: examples("image"), dot: "image" },
      { type: "model", kind: "video", title: "Видео", desc: examples("video"), dot: "video" },
      { type: "model", kind: "text", title: "Текст · AI", desc: "Промты, описания, перевод", dot: "text" },
    ],
  },
];

export function Sidebar() {
  const addNode = useStudio((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();

  const addAtCenter = (it: Item) => {
    const el = document.querySelector(".react-flow");
    const r = el?.getBoundingClientRect();
    const p = r
      ? screenToFlowPosition({ x: r.left + r.width / 2 - 160, y: r.top + r.height / 3 })
      : { x: 0, y: 0 };
    addNode(it.type, { x: Math.round(p.x), y: Math.round(p.y) }, it.kind); // store nudges it to free space
  };

  return (
    <aside className="sidebar" aria-label="Ноды">
      {GROUPS.map((g) => (
        <section key={g.title} className="palette">
          <h2 className="side-title">{g.title}</h2>
          {g.items.map((it) => (
            <button
              key={it.title}
              type="button"
              className="palette-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PALETTE_MIME, JSON.stringify({ type: it.type, kind: it.kind }));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => addAtCenter(it)}
            >
              <span className={`dot dot-${it.dot}`} aria-hidden />
              <span className="pi-text">
                <span className="pi-title">{it.title}</span>
                <span className="pi-desc">{it.desc}</span>
              </span>
            </button>
          ))}
        </section>
      ))}
      <div className="side-foot">
        <p>Соединяй выходы и входы одного цвета: голубой — текст, жёлтый — картинка, розовый — видео.</p>
        <p>Пробел или ЛКМ по фону — двигать холст, колесо — масштаб, Delete — удалить.</p>
      </div>
    </aside>
  );
}
