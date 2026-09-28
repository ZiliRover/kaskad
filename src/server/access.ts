import { graphOwner } from "./graphs";

/**
 * Who may read a stored file:
 *  uploads/<userId>/…   the uploader;
 *  outputs/<graphId>/…  the owner of that graph;
 *  uploads/<file>       pre-accounts uploads, adopted by the first account with their canvases;
 *  uploads/app-<id>/…   files a published app always uses: anyone signed in may run the app.
 */
export async function canReadFile(key: string, userId: string): Promise<boolean> {
  const [area, scope, rest] = key.split("/");
  if (area === "uploads") return rest === undefined || scope === userId || scope.startsWith("app-");
  if (area === "outputs" && rest !== undefined) return (await graphOwner(scope)) === userId;
  return false;
}
