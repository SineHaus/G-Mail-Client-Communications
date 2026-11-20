// Goodshuffle Pro messages: reading the extension's data and the reply text. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, isSupportLogin, needsReply, readGspMessage, sameText, stripSignOff } from "./gsp-messages.ts";

const inbound = {
  id: 9001,
  conversation: { id: 77, conversationType: "CLIENT" },
  date: "2026-11-19T15:04:00Z",
  eventType: "USER_MESSAGE",
  sender: { id: 5, contactID: 123, email: "pat@example.com", fullName: "Pat Doe", isCurrentUser: false },
  messageText: "<p>Hi! Do you have 10 round tables?</p><p>Thanks &amp; talk soon</p>",
  subject: "Re: Wishlist Received - (Project #232040555)",
  fromCurrentUser: false,
};

test("only the support@ Goodshuffle login counts", () => {
  assert.equal(isSupportLogin("support@theeventrentalguys.com"), true);
  assert.equal(isSupportLogin(" Support@TheEventRentalGuys.com "), true);
  assert.equal(isSupportLogin("leo@theeventrentalguys.com"), false);
  assert.equal(isSupportLogin(undefined), false);
});

test("a customer message is read with its words, sender and time", () => {
  const r = readGspMessage("232040555", inbound);
  assert.ok(r);
  assert.equal(r.gsp_message_id, "9001");
  assert.equal(r.direction, "inbound");
  assert.equal(r.sender_email, "pat@example.com");
  assert.equal(r.body, "Hi! Do you have 10 round tables?\nThanks & talk soon");
  assert.equal(r.sent_at, "2026-11-19T15:04:00.000Z");
});

test("our own messages and system notes are told apart; junk is skipped", () => {
  assert.equal(readGspMessage("232040555", { ...inbound, fromCurrentUser: true, sender: { id: 1, isCurrentUser: true } })?.direction, "outbound");
  assert.equal(readGspMessage("232040555", { ...inbound, eventType: "SYSTEM_ACTION" })?.direction, "system");
  assert.equal(readGspMessage("232040555", { messageText: "no id" }), null);
  assert.equal(readGspMessage("not-a-project", inbound), null);
});

test("a reply is due only when the newest message is the customer's", () => {
  const m = (id: string, direction: "inbound" | "outbound" | "system", at: string) => ({ gsp_message_id: id, direction, sent_at: at });
  assert.equal(needsReply([m("1", "outbound", "2026-11-18"), m("2", "inbound", "2026-11-19")]), "2");
  assert.equal(needsReply([m("2", "inbound", "2026-11-19"), m("3", "outbound", "2026-11-20")]), null);
  assert.equal(needsReply([m("2", "inbound", "2026-11-19"), m("4", "system", "2026-11-20")]), "2");
  assert.equal(needsReply([]), null);
});

test("the sign-off is left off, since Goodshuffle adds the signature", () => {
  assert.equal(stripSignOff("We have 10 tables for you.\n\nThanks,\nLeonel\nThe Event Rental Guys"), "We have 10 tables for you.");
  assert.equal(stripSignOff("We have 10 tables for you."), "We have 10 tables for you.");
});

test("text checks ignore spacing only", () => {
  assert.equal(sameText("a  b\n\nc", "a b c"), true);
  assert.equal(sameText("a b", "a b c"), false);
  assert.equal(htmlToText("a<br>b&nbsp;c"), "a\nb c");
});
