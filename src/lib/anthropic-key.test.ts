import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanApiKey, describeRefusedKey } from "./anthropic-key.ts";

const KEY = "sk-ant-api03-abcdefghijklmnop-WXYZ";

test("cleanApiKey strips quotes, prefixes and whitespace a paste can add", () => {
  for (const raw of [KEY, ` ${KEY}\n`, `"${KEY}"`, `'${KEY}'`, `“${KEY}”`, `ANTHROPIC_API_KEY=${KEY}`, `ANTHROPIC_API_KEY="${KEY}"`, `sk-ant-api03-abcdefgh\nijklmnop-WXYZ`]) {
    assert.equal(cleanApiKey(raw), KEY, JSON.stringify(raw));
  }
  assert.equal(cleanApiKey(undefined), undefined);
  assert.equal(cleanApiKey(' "" '), undefined);
});

test("describeRefusedKey never shows the key, only its last 4 characters", () => {
  const msg = describeRefusedKey(KEY);
  assert.match(msg, /ending in WXYZ/);
  assert.ok(!msg.includes("abcdefgh"));
  assert.match(describeRefusedKey(""), /No ANTHROPIC_API_KEY is set/);
  assert.match(describeRefusedKey("sk-ant-admin01-xxxxxxxxxxxx"), /sk-ant-admin, not sk-ant-api03-/);
  assert.match(describeRefusedKey("abc123456789xyz"), /doesn't start with sk-ant-api03-/);
  assert.match(describeRefusedKey("sk-ant-usr-" + "y".repeat(90) + "AA"), /sk-ant-usr, not sk-ant-api03-/);
  const full = "sk-ant-api03-" + "x".repeat(93) + "AA";
  assert.equal(full.length, 108);
  assert.doesNotMatch(describeRefusedKey(full), /part of it is missing/);
  assert.match(describeRefusedKey(full.slice(0, 50) + full.slice(52)), /106 characters\).*part of it is missing/);
});
