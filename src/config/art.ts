/**
 * Real results of the studio (a live run of the marketplace cards, September 2026),
 * shipped in public/art for the sign-in page. Nothing here is a stock image.
 */
export interface ArtSet {
  id: string;
  /** what the product is, as the seller would say it */
  name: string;
  market: "Wildberries" | "Ozon";
  /** slide numbers that look good on their own (1-based) */
  best: number[];
}

export const ART_SETS: ArtSet[] = [
  { id: "bag", name: "Сумка-шоппер", market: "Wildberries", best: [2, 3, 6, 7] },
  { id: "buds", name: "Наушники TWS", market: "Ozon", best: [1, 2, 3, 6] },
  { id: "hoodie", name: "Худи оверсайз", market: "Wildberries", best: [1, 4, 6, 7] },
  { id: "thermos", name: "Термос 750 мл", market: "Ozon", best: [1, 3, 6, 7] },
  { id: "backpack", name: "Детский рюкзак", market: "Wildberries", best: [1, 2, 3, 7] },
  { id: "sneakers", name: "Беговые кроссовки", market: "Wildberries", best: [1, 2, 3, 6] },
  { id: "linen", name: "Льняное бельё", market: "Wildberries", best: [2, 3, 4, 6] },
  { id: "serum", name: "Сыворотка с витамином C", market: "Wildberries", best: [2, 3, 4, 7] },
];

export const artPhoto = (id: string) => `/art/${id}/0.jpg`;
export const artSlide = (id: string, n: number) => `/art/${id}/${n}.jpg`;

/** short generated videos for the wall */
export const ART_VIDEOS = [
  { src: "/art/rain.mp4", poster: "/art/rain.jpg" },
  { src: "/art/cafe.mp4", poster: "/art/cafe.jpg" },
];
