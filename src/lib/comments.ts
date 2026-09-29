export interface Comment {
  id: string;
  parentId: string | null;
  /** canvas position of the thread's pin (root comments) */
  x: number;
  y: number;
  text: string;
  resolved: boolean;
  createdAt: string;
  author: { id: string; email: string };
}
