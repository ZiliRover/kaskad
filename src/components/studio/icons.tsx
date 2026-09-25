"use client";

import {
  ArrowsOutSimpleIcon, BezierCurveIcon, ChatCenteredTextIcon, FilmReelIcon, FilmStripIcon, FrameCornersIcon,
  ImageIcon, ImagesIcon, MagicWandIcon, PaintBrushIcon, PencilSimpleIcon, SpeakerHighIcon, SquaresFourIcon,
  TextAaIcon, UploadSimpleIcon, WaveformIcon, type Icon,
} from "@phosphor-icons/react";
import type { DType, ModelCaps, ModelGroup } from "@/lib/models/types";

/** One icon per node type, tinted with the color of the data it produces. */
export type NodeKey = "prompt" | "upload" | `upload:${"image" | "video" | "audio"}` | `model:${"image" | "video" | "text"}`;

const NODE_ICONS: Record<NodeKey, Icon> = {
  prompt: TextAaIcon,
  upload: UploadSimpleIcon,
  "upload:image": ImageIcon,
  "upload:video": FilmReelIcon,
  "upload:audio": WaveformIcon,
  "model:image": MagicWandIcon,
  "model:video": FilmStripIcon,
  "model:text": ChatCenteredTextIcon,
};

export function NodeIcon({ node, dtype, size = 16 }: { node: NodeKey; dtype: DType; size?: number }) {
  const I = NODE_ICONS[node];
  return <I size={size} weight="regular" className={`type-icon t-${dtype}`} aria-hidden />;
}

/** Palette group icons: what the models in the group do. */
export const GROUP_ICONS: Record<ModelGroup, Icon> = {
  video: FilmStripIcon,
  "video-edit": PencilSimpleIcon,
  image: MagicWandIcon,
  "image-style": PaintBrushIcon,
  "image-vector": BezierCurveIcon,
  text: ChatCenteredTextIcon,
};

/** Capability badges, each with a plain-language explanation. */
const CAPS: { key: keyof ModelCaps; icon: Icon; label: string }[] = [
  { key: "frames", icon: FrameCornersIcon, label: "Первый и последний кадр" },
  { key: "refs", icon: ImagesIcon, label: "Референсы-картинки" },
  { key: "mediaRefs", icon: WaveformIcon, label: "Видео- и аудио-референсы" },
  { key: "audio", icon: SpeakerHighIcon, label: "Генерирует звук" },
  { key: "variants", icon: SquaresFourIcon, label: "Несколько вариантов за раз" },
  { key: "vector", icon: BezierCurveIcon, label: "Вектор SVG" },
  { key: "sourceVideo", icon: ArrowsOutSimpleIcon, label: "Работает с готовым видео" },
];

export function capList(caps: ModelCaps) {
  return CAPS.filter((c) => (c.key === "variants" ? caps.variants > 1 : caps[c.key]));
}

export function CapIcons({ caps }: { caps: ModelCaps }) {
  const list = capList(caps);
  if (!list.length) return null;
  return (
    <span className="caps" aria-label={list.map((c) => c.label).join(", ")}>
      {list.map(({ key, icon: I, label }) => (
        <span key={key} className="cap" title={label}><I size={12} weight="bold" aria-hidden /></span>
      ))}
    </span>
  );
}
