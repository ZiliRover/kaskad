/** A work in the showcase feed. */
export interface FeedPost {
  id: string;
  kind: "image" | "video";
  url: string;
  width: number;
  height: number;
  /** null when the author keeps the prompt to themselves */
  prompt: string | null;
  model: string;
  createdAt: string;
  likes: number;
  liked: boolean;
  mine: boolean;
  /** off the wall after complaints: only the author and operators see it */
  hidden: boolean;
  /** complaints so far, shown to operators only */
  reports: number;
}
