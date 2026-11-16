// Who may do what. Pure module (unit-tested). Owners have every permission on every account;
// everyone else has a role per Gmail account (or no access, which hides that account entirely).

export type Role = "owner" | "approver" | "editor" | "viewer";
export type Permission =
  | "view"          // see the account's queue, clients, projects, history
  | "edit"          // edit drafts, Decline, Review/redraft, link projects, edit clients, mark read
  | "approve"       // press Approve (send)
  | "manage";       // connect/disconnect accounts, team, reply rules (owner only)

const MATRIX: Record<Role, Permission[]> = {
  owner: ["view", "edit", "approve", "manage"],
  approver: ["view", "edit", "approve"],
  editor: ["view", "edit"],
  viewer: ["view"],
};

export function can(role: Role | null | undefined, p: Permission): boolean {
  return !!role && MATRIX[role].includes(p);
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  approver: "Approver",
  editor: "Editor",
  viewer: "Viewer",
};
