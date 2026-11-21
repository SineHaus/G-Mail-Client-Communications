import { test } from "node:test";
import assert from "node:assert/strict";

// When a failed Google token request means "reconnect", and when it is only a failed check. Run with: npm test
import { isRejectedSignIn } from "./sync-health-rule.ts";

const err = (status: number, text: string) => Object.assign(new Error(`Google token error ${status}: ${text}`), { status });

test("a revoked or expired sign-in needs a reconnect", () => {
  assert.equal(isRejectedSignIn(err(400, '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}')), true);
  assert.equal(isRejectedSignIn(err(401, '{"error":"invalid_client"}')), true);
});

test("an outage or network error is only a failed check", () => {
  assert.equal(isRejectedSignIn(err(500, "backend error")), false);
  assert.equal(isRejectedSignIn(err(503, "unavailable")), false);
  assert.equal(isRejectedSignIn(new Error("fetch failed")), false);
  assert.equal(isRejectedSignIn(err(400, '{"error":"invalid_request"}')), false);
});
