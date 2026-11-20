// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_FACTS,
  applyItemChange,
  cleanGoodshuffleUrl,
  deliveryPlan,
  isThanksgiving,
  mergeInfo,
  missingItems,
  parseChecklist,
  answerFor,
  textToItems,
  itemsToText,
} from "./quote-rules.ts";

const plan = (event_date: string, extra: Partial<typeof EMPTY_FACTS> = {}) => deliveryPlan({ ...EMPTY_FACTS, event_date, ...extra });

test("checklist: default list, optional items, one per line", () => {
  const c = parseChecklist("");
  assert.ok(c.find((i) => i.key === "guest_count"));
  assert.equal(c.find((i) => i.key === "tax_exempt_form")?.optional, true);
  const custom = parseChecklist("- Name\n- Event date\n\n- Name\n- Linens (optional)");
  assert.deepEqual(custom.map((i) => i.key), ["name", "event_date", "linens"]);
  assert.equal(custom[2].optional, true);
});

test("missing items skip optional ones and treat 'unknown' as missing", () => {
  const c = parseChecklist("Name\nEvent date\nTax-exempt form (optional)");
  assert.deepEqual(missingItems(c, { name: "Ana", event_date: "unknown" }).map((i) => i.key), ["event_date"]);
  assert.deepEqual(missingItems(c, { name: "Ana", event_date: "June 6" }), []);
});

test("checklist: Leo's list, with items that only count for a tent, dance floor, stage or venue", () => {
  const c = parseChecklist("");
  const keys = c.map((i) => i.key);
  for (const k of ["name", "email", "phone", "event_date", "event_type", "event_address", "items_and_quantities", "delivery_or_warehouse_pickup"]) assert.ok(keys.includes(k), k);
  assert.equal(c.find((i) => i.key === "guest_count")?.optional, true);
  assert.deepEqual(c.find((i) => i.key === "tent_size_and_whether_it_needs_heat")?.when, ["tent"]);
  const base = {
    name: "Ana", email: "a@x.com", phone: "555", event_date: "June 6", event_type: "Birthday", start_and_end_times: "2-6pm",
    home_or_venue: "home", event_address: "1 Main St", delivery_or_warehouse_pickup: "delivery",
  };
  // Chairs at home: nothing conditional is needed.
  assert.deepEqual(missingItems(c, { ...base, items_and_quantities: "60 chairs, 6 tables" }).map((i) => i.key), []);
  // A tent and a dance floor bring their own questions.
  assert.deepEqual(
    missingItems(c, { ...base, items_and_quantities: "1 20x40 tent, dance floor" }).map((i) => i.key),
    ["tent_size_and_whether_it_needs_heat", "dance_floor_size_and_color_and_whether_it_s_on_grass"],
  );
  // At a venue the venue's name is needed too.
  assert.deepEqual(missingItems(c, { ...base, home_or_venue: "venue", items_and_quantities: "60 chairs" }).map((i) => i.key), ["venue_name"]);
  // "tents" counts as tent; "stagecoach" doesn't count as stage.
  assert.equal(missingItems(c, { ...base, items_and_quantities: "2 tents, stagecoach theme" }).length, 1);
});

test("a quote started before the checklist changed keeps its venue address", () => {
  const c = parseChecklist("Event address");
  assert.deepEqual(missingItems(c, { venue_address: "9 Elm St" }), []);
  assert.equal(answerFor({ venue_address: "9 Elm St" }, "event_address"), "9 Elm St");
});

test("merging answers never erases an earlier one", () => {
  assert.deepEqual(mergeInfo({ name: "Ana", phone: "555" }, { name: "", phone: "777", guest_count: "80" }), {
    name: "Ana",
    phone: "777",
    guest_count: "80",
  });
});

test("items round-trip through the edit box, and command changes apply", () => {
  const items = textToItems("10 x white chairs (ceremony)\n2 tables\n? x heaters");
  assert.deepEqual(items[0], { name: "white chairs", quantity: 10, note: "ceremony" });
  assert.equal(items[1].quantity, 2);
  assert.equal(items[2].quantity, null);
  assert.match(itemsToText(items), /^10 x white chairs \(ceremony\)/);
  const changed = applyItemChange(items, [{ name: "White chair", quantity: 10 }, { name: "Dance floor", quantity: 1 }], ["tables"]);
  assert.equal(changed.find((i) => i.name === "white chairs")?.quantity, 20);
  assert.ok(changed.find((i) => i.name === "Dance floor"));
  assert.ok(!changed.find((i) => i.name === "tables"));
  const fewer = applyItemChange(changed, [{ name: "white chairs", quantity: -20 }, { name: "tent", quantity: -1 }], []);
  assert.ok(!fewer.find((i) => i.name === "white chairs"));
  assert.ok(!fewer.find((i) => i.name === "tent"));
});

test("only Goodshuffle Pro links are accepted", () => {
  assert.equal(
    cleanGoodshuffleUrl("pro.goodshuffle.com/app/project/detail?id=231983312&tab=contract"),
    "https://pro.goodshuffle.com/app/project/detail?id=231983312&tab=contract",
  );
  assert.equal(cleanGoodshuffleUrl("https://pro.goodshuffle.com.evil.example/app"), null);
  assert.equal(cleanGoodshuffleUrl("http://pro.goodshuffle.com/app"), null);
  assert.equal(cleanGoodshuffleUrl("https://user:pw@pro.goodshuffle.com/app"), null);
  assert.equal(cleanGoodshuffleUrl("not a link"), null);
});

test("Saturday at a home: drop Thu or Fri, pick up Mon or Tue, 8 to 6", () => {
  const p = plan("2027-06-05", { venue_type: "home" }); // a Saturday
  assert.equal(p.dropoff, "Thursday Jun 3 or Friday Jun 4, 8 AM to 6 PM");
  assert.equal(p.pickup, "Monday Jun 7 or Tuesday Jun 8, 8 AM to 6 PM");
  assert.match(p.fee, /Standard delivery/);
});

test("Sunday at a home uses the same Thu/Fri and Mon/Tue", () => {
  const p = plan("2027-06-06", { venue_type: "home" });
  assert.equal(p.dropoff, "Thursday Jun 3 or Friday Jun 4, 8 AM to 6 PM");
  assert.equal(p.pickup, "Monday Jun 7 or Tuesday Jun 8, 8 AM to 6 PM");
});

test("Saturday and Sunday at a venue: same-morning drop-off, next-morning pickup", () => {
  const sat = plan("2027-06-05", { venue_type: "venue" });
  assert.equal(sat.dropoff, "Saturday Jun 5, 8 AM to 12 PM");
  assert.equal(sat.pickup, "Sunday Jun 6, 8 AM to 12 PM");
  const sun = plan("2027-06-06", { venue_type: "venue" });
  assert.equal(sun.dropoff, "Sunday Jun 6, 8 AM to 12 PM");
  assert.equal(sun.pickup, "Monday Jun 7, 8 AM to 12 PM");
  assert.ok(sat.flags.some((f) => /check the exact-time cost with Leo/.test(f)));
});

test("Friday: drop Wed or Thu; home picks up Mon or Tue, venue Saturday morning", () => {
  const home = plan("2027-06-04", { venue_type: "home" });
  assert.equal(home.dropoff, "Wednesday Jun 2 or Thursday Jun 3, 8 AM to 6 PM");
  assert.equal(home.pickup, "Monday Jun 7 or Tuesday Jun 8, 8 AM to 6 PM");
  assert.equal(plan("2027-06-04", { venue_type: "venue" }).pickup, "Saturday Jun 5, 8 AM to 12 PM");
});

test("midweek: day before and day after; same-day drop-off is the morning, early starts flagged", () => {
  const p = plan("2027-06-09", { venue_type: "venue" }); // Wednesday
  assert.equal(p.dropoff, "Tuesday Jun 8, 8 AM to 6 PM");
  assert.equal(p.pickup, "Thursday Jun 10, 8 AM to 6 PM");
  const same = plan("2027-06-09", { venue_type: "venue", same_day_dropoff: true, event_start: "10:00" });
  assert.equal(same.dropoff, "Wednesday Jun 9, 8 AM to 12 PM");
  assert.ok(same.flags.some((f) => /starts early/.test(f)));
  const night = plan("2027-06-09", { venue_type: "venue", same_night_pickup: true });
  assert.ok(night.flags.some((f) => /\$200/.test(f)));
});

test("Thanksgiving: drop Tue or Wed before, pick up Fri or Sat", () => {
  assert.ok(isThanksgiving(new Date(Date.UTC(2026, 10, 26))));
  assert.ok(!isThanksgiving(new Date(Date.UTC(2026, 10, 19))));
  const p = plan("2026-11-26", { venue_type: "home" });
  assert.equal(p.dropoff, "Tuesday Nov 24 or Wednesday Nov 25, 8 AM to 6 PM");
  assert.equal(p.pickup, "Friday Nov 27 or Saturday Nov 28, 8 AM to 6 PM");
});

test("fees and flags: North Jersey stage $250 each way, Saturday pickup goes to Leo", () => {
  const p = plan("2027-06-05", { venue_type: "venue", stage_or_dance_floor: true, north_jersey: true, saturday_pickup: true });
  assert.match(p.fee, /\$250 each way/);
  assert.ok(!p.flags.some((f) => /check the exact-time cost/.test(f)));
  assert.ok(p.flags.some((f) => /Saturday pickup/.test(f)));
  assert.equal(plan("").dropoff, "Needs the event date.");
});
