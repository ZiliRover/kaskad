/** One entry of the media library: a result from any project, or an upload. */
export interface MediaItem {
  id: string;
  kind: "image" | "video" | "audio" | "text";
  fileKey: string | null;
  url: string | null;
  text: string | null;
  createdAt: string;
  /** null for uploads and app runs */
  projectId: string | null;
  projectName: string | null;
  /** model that made it, or the upload's file name */
  title: string;
  prompt: string | null;
}
