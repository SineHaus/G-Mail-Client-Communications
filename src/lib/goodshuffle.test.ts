// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeB64Url, type GmailMessage } from "./email-parse.ts";
import { matchWishlist, namesAgree, normPhone, parseWishlistNotice, type WishlistRow } from "./goodshuffle.ts";

const ME = "support@theeventrentalguys.com";

// The text of a real notice (Nov 2025), with a made-up customer.
const NOTICE_TEXT = `New Wishlist Submission
Hi The Event Rental Guys,

Congrats! Jane Doe submitted a new Wishlist ‘Doe - Jane Doe #231009191’.

A new project has been created in your account. Click the link below to open your project.

View Project

Project

Doe - Jane Doe - #231009191

Contact

Jane Doe
(973) 555-0142

Venue

Jane Doe
1 Main st
Montclair, NJ 07042

Contract Details

Status: New Project`;

function notice(opts: { html?: string; plain?: string; replyTo?: string; date?: string }): GmailMessage {
  const parts = [];
  if (opts.plain) parts.push({ mimeType: "text/plain", body: { data: encodeB64Url(opts.plain) } });
  if (opts.html) parts.push({ mimeType: "text/html", body: { data: encodeB64Url(opts.html) } });
  const headers = [
    { name: "From", value: "Goodshuffle Pro <info@mg.goodshuffle.com>" },
    { name: "Subject", value: "New Wishlist Submission - Nov 28, 2025 @ 03:38 PM" },
  ];
  if (opts.replyTo) headers.push({ name: "Reply-To", value: opts.replyTo });
  return {
    id: "m1",
    threadId: "t1",
    internalDate: String(Date.parse(opts.date ?? "2026-11-10T15:00:00Z")),
    payload: { mimeType: "multipart/alternative", headers, parts },
  };
}

const HTML = `<html><body><h1>New Wishlist Submission</h1><p>Congrats! Jane Doe submitted a new Wishlist ‘Doe - Jane Doe #231009191’.</p>
<a href="https://pro.goodshuffle.com/app/project/detail?id=231009191">View Project</a>
<h3>Project</h3><p>Doe - Jane Doe - #231009191</p><h3>Contact</h3><p>Jane Doe<br>(973) 555-0142</p><h3>Venue</h3><p>Jane Doe<br>1 Main st</p>
<h3>Contract Details</h3></body></html>`;

test("parseWishlistNotice reads the project link, name, contact and Reply-To", () => {
  const n = parseWishlistNotice(notice({ html: HTML, replyTo: "Jane Doe <Jane.Doe@gmail.com>" }), ME);
  assert.ok(n);
  assert.equal(n.projectId, "231009191");
  assert.equal(n.url, "https://pro.goodshuffle.com/app/project/detail?id=231009191");
  assert.equal(n.projectName, "Doe - Jane Doe - #231009191");
  assert.equal(n.contactName, "Jane Doe");
  assert.equal(n.phone, "(973) 555-0142");
  assert.equal(n.email, "jane.doe@gmail.com");
  assert.equal(n.receivedAt, "2026-11-10T15:00:00.000Z");
});

test("parseWishlistNotice: plain text only, link wrapped by a tracker, Reply-To is Goodshuffle's own", () => {
  const n = parseWishlistNotice(notice({ plain: NOTICE_TEXT, replyTo: "help@goodshuffle.com" }), ME);
  assert.ok(n);
  assert.equal(n.projectId, "231009191"); // from "#231009191"
  assert.equal(n.url, "https://pro.goodshuffle.com/app/project/detail?id=231009191");
  assert.equal(n.email, null);
  assert.equal(n.phone, "(973) 555-0142");
});

test("parseWishlistNotice: no project id → null", () => {
  assert.equal(parseWishlistNotice(notice({ plain: "New Wishlist Submission\nHi there" }), ME), null);
});

test("normPhone and namesAgree", () => {
  assert.equal(normPhone("+1 (973) 555-0142"), "9735550142");
  assert.equal(normPhone("555-0142"), null);
  assert.equal(namesAgree("Jane Doe", "jane  DOE"), true);
  assert.equal(namesAgree("Jane Q. Doe", "Jane Doe"), true);
  assert.equal(namesAgree("Jane", "Jane Doe"), true);
  assert.equal(namesAgree("José Pérez", "Jose Perez"), true);
  assert.equal(namesAgree("John Doe", "Jane Doe"), false);
  assert.equal(namesAgree("Jane Smith", "Jane Doe"), false);
  assert.equal(namesAgree("", "Jane Doe"), false);
});

const W = (o: Partial<WishlistRow>): WishlistRow => ({
  gsp_project_id: "1",
  url: "https://pro.goodshuffle.com/app/project/detail?id=1",
  project_name: null,
  contact_name: "Jane Doe",
  phone: "(973) 555-0142",
  email: "jane@gmail.com",
  received_at: "2026-11-10T15:00:00.000Z",
  ...o,
});
const AT = "2026-11-11T12:00:00.000Z";

test("matchWishlist: name + email around the request → linked", () => {
  const m = matchWishlist({ names: ["Jane Doe"], emails: ["JANE@gmail.com"], phones: [] }, [W({})], AT);
  assert.equal(m?.level, "linked");
  assert.equal(m?.why, "name + email match");
});

test("matchWishlist: name + phone → linked, even with another email", () => {
  const m = matchWishlist({ names: ["Jane"], emails: ["other@x.com"], phones: ["973.555.0142"] }, [W({})], AT);
  assert.equal(m?.level, "linked");
  assert.equal(m?.why, "name + phone match");
});

test("matchWishlist: email or phone without the name → only possible", () => {
  assert.equal(matchWishlist({ names: ["Bob Doe"], emails: ["jane@gmail.com"], phones: [] }, [W({})], AT)?.level, "possible");
  const m = matchWishlist({ names: [], emails: [], phones: ["9735550142"] }, [W({})], AT);
  assert.equal(m?.level, "possible");
  assert.equal(m?.why, "phone match only");
});

test("matchWishlist: a strong match from long ago is only possible (a past event)", () => {
  const m = matchWishlist({ names: ["Jane Doe"], emails: ["jane@gmail.com"], phones: [] }, [W({ received_at: "2025-11-28T15:00:00.000Z" })], AT);
  assert.equal(m?.level, "possible");
  assert.match(m!.why, /2025-11-28/);
});

test("matchWishlist: two projects fit → possible, newest shown", () => {
  const m = matchWishlist(
    { names: ["Jane Doe"], emails: ["jane@gmail.com"], phones: [] },
    [W({ gsp_project_id: "1" }), W({ gsp_project_id: "2", received_at: "2026-11-11T09:00:00.000Z" })],
    AT,
  );
  assert.equal(m?.level, "possible");
  assert.equal(m?.wishlist.gsp_project_id, "2");
});

test("matchWishlist: a name alone counts once, never when two people share it, never linked", () => {
  assert.equal(matchWishlist({ names: ["Jane Doe"], emails: [], phones: [] }, [W({ email: null, phone: null })], AT)?.level, "possible");
  assert.equal(
    matchWishlist({ names: ["Jane Doe"], emails: [], phones: [] }, [W({ email: null, phone: null }), W({ gsp_project_id: "2", email: null, phone: null })], AT),
    null,
  );
  assert.equal(matchWishlist({ names: ["Ann Lee"], emails: ["a@b.com"], phones: [] }, [W({})], AT), null);
});
