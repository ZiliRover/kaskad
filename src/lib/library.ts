import type { ASSET_KINDS } from "./graph/types";

export type AssetKind = (typeof ASSET_KINDS)[number];

/** A library item as the studio sees it. */
export interface LibraryItem {
  id: string;
  kind: AssetKind;
  name: string;
  description: string;
  files: string[];
  thumbs: string[];
  updatedAt: string;
}

export const ASSET_LABEL: Record<AssetKind, string> = {
  character: "Персонаж", product: "Товар", brand: "Бренд", style: "Стиль",
};

export const ASSET_HINT: Record<AssetKind, string> = {
  character: "Внешность, одежда, характер. Фото: 2–6 ракурсов одного персонажа",
  product: "Что за товар, материал, цвет, детали. Фото: товар с разных сторон",
  brand: "Цвета (HEX), шрифты, тон, что можно и нельзя. Фото: логотип и примеры стиля",
  style: "Каким должен быть результат: свет, палитра, настроение. Фото: 3–9 образцов",
};
