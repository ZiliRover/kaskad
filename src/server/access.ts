import { graphAccess, shareAProject } from "./sharing";

/**
 * Who may read a stored file:
 *  uploads/<userId>/…   the uploader, and people working with them on a shared project;
 *  outputs/<graphId>/…  anyone who can open that project;
 *  uploads/<file>       pre-accounts uploads, adopted by the first account with their canvases;
 *  uploads/app-<id>/…   files a published app always uses: anyone signed in may run the app.
 */
export async function canReadFile(key: string, userId: string): Promise<boolean> {
  const [area, scope, rest] = key.split("/");
  if (area === "uploads") {
    if (rest === undefined || scope === userId || scope.startsWith("app-")) return true;
    return /^[0-9a-f-]{36}$/.test(scope) && shareAProject(scope, userId);
  }
  if (area === "outputs" && rest !== undefined) return !!(await graphAccess(scope, userId));
  return false;
}
