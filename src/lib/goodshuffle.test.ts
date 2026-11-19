// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeB64Url, type GmailMessage } from "./email-parse.ts";
import {
  bestMatch,
  customerEmails,
  matchProjectMention,
  matchWishlist,
  mentionsFromEmails,
  namesAgree,
  normPhone,
  parseWishlistNotice,
  projectIdsInSubject,
  type MentionEmailRow,
  type WishlistRow,
} from "./goodshuffle.ts";

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

// ---------- Project numbers in subjects ----------

test("projectIdsInSubject reads Goodshuffle's quote and invoice subjects", () => {
  assert.deepEqual(projectIdsInSubject("Re: Quote for Emma Hutton (Project #232032021)"), ["232032021"]);
  assert.deepEqual(projectIdsInSubject("Invoice for Boudreau - 90 Morningside Rd (Project #231946850)"), ["231946850"]);
  assert.deepEqual(projectIdsInSubject("Order information Contract #:735988"), []);
  assert.deepEqual(projectIdsInSubject("Project #12 is too short"), []);
  assert.deepEqual(projectIdsInSubject(null), []);
});

test("customerEmails drops this inbox and the business's own domain, not gmail", () => {
  assert.deepEqual(
    customerEmails(["logistics@theeventrentalguys.com", "Emmarh@umich.edu", null, "emmarh@umich.edu"], ME),
    ["emmarh@umich.edu"],
  );
  assert.deepEqual(customerEmails(["me@gmail.com", "jane@gmail.com"], "me@gmail.com"), ["jane@gmail.com"]);
});

const E = (o: Partial<MentionEmailRow>): MentionEmailRow => ({
  gmail_thread_id: "t-quote-email",
  direction: "inbound",
  from_address: "emmarh@umich.edu",
  to_addresses: ME,
  subject: "Re: Quote for Emma Hutton (Project #232032021)",
  sent_at: "2026-11-19T20:00:00.000Z",
  ...o,
});
const QAT = "2026-11-19T18:00:00.000Z";
const EMMA = { emails: ["logistics@theeventrentalguys.com", "emmarh@umich.edu"] };

test("matchProjectMention: the customer's reply on Goodshuffle's quote email links the project", () => {
  const m = matchProjectMention(EMMA, "t-form", mentionsFromEmails([E({})]), QAT, ME);
  assert.equal(m?.level, "linked");
  assert.equal(m?.wishlist.url, "https://pro.goodshuffle.com/app/project/detail?id=232032021");
  assert.equal(m?.wishlist.project_name, "Quote for Emma Hutton (Project #232032021)");
  assert.equal(m?.why, "project number in an email with emmarh@umich.edu");
});

test("matchProjectMention: outbound emails count by recipient; own-domain addresses never match", () => {
  const out = E({ direction: "outbound", from_address: ME, to_addresses: "Emma Hutton <emmarh@umich.edu>" });
  assert.equal(matchProjectMention(EMMA, null, mentionsFromEmails([out]), QAT, ME)?.level, "linked");
  const internal = E({ from_address: "logistics@theeventrentalguys.com" });
  assert.equal(matchProjectMention({ emails: ["logistics@theeventrentalguys.com"] }, null, mentionsFromEmails([internal]), QAT, ME), null);
});

test("matchProjectMention: same thread links even without an address; other clients don't match", () => {
  const m = matchProjectMention({ emails: [] }, "t-quote-email", mentionsFromEmails([E({ from_address: "x@y.com" })]), QAT, ME);
  assert.equal(m?.level, "linked");
  assert.equal(m?.why, "project number in this email thread");
  assert.equal(matchProjectMention({ emails: ["bob@x.com"] }, "t-other", mentionsFromEmails([E({})]), QAT, ME), null);
});

test("matchProjectMention: two projects, or only an old one, are possible", () => {
  const two = mentionsFromEmails([E({}), E({ subject: "Invoice for Hutton (Project #231000001)", sent_at: "2026-11-18T10:00:00.000Z" })]);
  const m = matchProjectMention(EMMA, null, two, QAT, ME);
  assert.equal(m?.level, "possible");
  assert.equal(m?.wishlist.gsp_project_id, "232032021");
  const old = matchProjectMention(EMMA, null, mentionsFromEmails([E({ sent_at: "2025-06-01T10:00:00.000Z" })]), QAT, ME);
  assert.equal(old?.level, "possible");
  assert.match(old!.why, /2025-06-01/);
});

test("bestMatch prefers a sure match and flags two sure ones that disagree", () => {
  const sure = (id: string) => ({ wishlist: W({ gsp_project_id: id }), level: "linked" as const, why: "x" });
  const maybe = { wishlist: W({ gsp_project_id: "9" }), level: "possible" as const, why: "y" };
  assert.equal(bestMatch(maybe, sure("2"))?.wishlist.gsp_project_id, "2");
  assert.equal(bestMatch(sure("1"), sure("1"))?.level, "linked");
  assert.equal(bestMatch(sure("1"), sure("2"))?.level, "possible");
  assert.equal(bestMatch(null, null), null);
});
