import { test } from "node:test";
import assert from "node:assert/strict";
import { can } from "./permissions.ts";

test("only Owner and Approver can send", () => {
  assert.equal(can("owner", "approve"), true);
  assert.equal(can("approver", "approve"), true);
  assert.equal(can("editor", "approve"), false);
  assert.equal(can("viewer", "approve"), false);
  assert.equal(can(null, "approve"), false);
});

test("Editors edit/decline but can't send; Viewers only read", () => {
  assert.equal(can("editor", "edit"), true);
  assert.equal(can("viewer", "edit"), false);
  assert.equal(can("viewer", "view"), true);
});

test("no access means nothing at all", () => {
  for (const p of ["view", "edit", "approve", "manage"] as const) assert.equal(can(undefined, p), false);
});

test("only the Owner manages accounts and the team", () => {
  assert.equal(can("owner", "manage"), true);
  for (const r of ["approver", "editor", "viewer"] as const) assert.equal(can(r, "manage"), false);
});
