export type Role = "owner" | "editor" | "viewer";

export interface Member {
  /** null for an invitation still waiting for the person to sign up */
  userId: string | null;
  email: string;
  role: Role;
  pending: boolean;
}

export const ROLE_LABEL: Record<Role, string> = { owner: "владелец", editor: "редактор", viewer: "зритель" };
