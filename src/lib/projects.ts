/** A canvas in the user's project list. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** working nodes (notes and groups not counted) */
  nodes: number;
}
