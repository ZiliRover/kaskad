/** Where a "Карточки для маркетплейса" set is, slide by slide. */
export interface CardsProgress {
  name: string;
  marketplace: "wb" | "ozon";
  slides: { status: "waiting" | "working" | "done" | "failed"; url: string | null; error: string | null }[];
  /** what the set cost so far, in kopecks; null while nothing is settled */
  chargedKop: number | null;
}
