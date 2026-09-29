/** A canvas in the user's project list. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** working nodes (notes and groups not counted) */
  nodes: number;
  /** your role in it; shared projects show who owns them */
  role: "owner" | "editor" | "viewer";
  ownerEmail: string | null;
}
