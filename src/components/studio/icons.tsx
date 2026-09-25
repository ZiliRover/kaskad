"use client";

import {
  ChatCenteredTextIcon, FilmStripIcon, ImageIcon, MagicWandIcon, TextAaIcon, type Icon,
} from "@phosphor-icons/react";
import type { MediaKind } from "@/lib/models/types";

/** One icon per node type, tinted with the color of the data it produces. */
export type NodeKey = "prompt" | "image" | `model:${MediaKind}`;

const ICONS: Record<NodeKey, Icon> = {
  prompt: TextAaIcon,
  image: ImageIcon,
  "model:image": MagicWandIcon,
  "model:video": FilmStripIcon,
  "model:text": ChatCenteredTextIcon,
};

export function NodeIcon({ node, dtype, size = 16 }: { node: NodeKey; dtype: MediaKind; size?: number }) {
  const I = ICONS[node];
  return <I size={size} weight="regular" className={`type-icon t-${dtype}`} aria-hidden />;
}
