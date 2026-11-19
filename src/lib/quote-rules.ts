// Quote rules: the required-info checklist, what's still missing, and the drop-off / pickup days
// Claude proposes INSIDE a quote card for Leo. Pure module (unit-tested, no database).
// Customers are never offered dates: these days appear only on approval cards for the team.

// ---------- Required-info checklist ----------

/**
 * Draft checklist from the build plan (Leo still has to confirm it). Editable in Settings →
 * Quote checklist, one item per line. "(optional)" at the end of a line means Claude asks for it
 * but a quote can be built without it.
 */
export const DEFAULT_CHECKLIST = `Name
Phone
Email
Event type
Event date
Start and end times
Home or venue
Venue address
Indoor or outdoor, and surface
Guest count
Items and quantities
Setup wanted
Tax-exempt form (optional)`;

export interface ChecklistItem {
  key: string;
  label: string;
  optional: boolean;
}

export function slug(label: string) {
  return label
    .toLowerCase()
    .replace(/\(optional\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseChecklist(text: string | null | undefined): ChecklistItem[] {
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  for (const raw of (text?.trim() ? text : DEFAULT_CHECKLIST).split("\n")) {
    const line = raw.replace(/^[-*•\d.)\s]+/, "").trim();
    if (!line) continue;
    const optional = /\(optional\)\s*$/i.test(line) || /\bif any\b/i.test(line);
    const label = line.replace(/\s*\(optional\)\s*$/i, "").trim();
    const key = slug(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, optional });
  }
  return out;
}

const EMPTY = /^(|n\/a|unknown|\?|tbd|not given|not provided)$/i;

export function hasValue(v: unknown) {
  return typeof v === "string" ? !EMPTY.test(v.trim()) : v != null;
}

/** Required checklist items with no answer yet (optional ones never block a quote). */
export function missingItems(checklist: ChecklistItem[], info: Record<string, string>): ChecklistItem[] {
  return checklist.filter((c) => !c.optional && !hasValue(info[c.key]));
}

/** Merge new answers into old ones: a new non-empty answer wins, an empty one never erases. */
export function mergeInfo(old: Record<string, string>, next: Record<string, string>) {
  const out = { ...old };
  for (const [k, v] of Object.entries(next)) if (hasValue(v)) out[k] = v.trim();
  return out;
}

// ---------- Items ----------

export interface QuoteItem {
  name: string;
  quantity: number | null;
  note?: string | null;
}

/** The checklist item that the item list answers. */
export const ITEMS_KEY = "items_and_quantities";

/** One line for the checklist, e.g. "10 white chairs, 2 tables". */
export function itemsSummary(items: QuoteItem[]) {
  return items.map((i) => `${i.quantity ?? "?"} ${i.name}`).join(", ");
}

/** "10 x white chairs (for ceremony)" lines ⇄ items, for the edit box on a quote card. */
export function itemsToText(items: QuoteItem[]) {
  return items.map((i) => `${i.quantity ?? "?"} x ${i.name}${i.note ? ` (${i.note})` : ""}`).join("\n");
}

export function textToItems(text: string): QuoteItem[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(\d+|\?)\s*(?:x|×)?\s+(.+?)(?:\s*\((.+)\))?$/i.exec(l);
      if (!m) return { name: l, quantity: null };
      return { name: m[2].trim(), quantity: m[1] === "?" ? null : Number(m[1]), note: m[3]?.trim() || null };
    });
}

/** Apply a command's change: set quantities by name (case-insensitive), add new ones, remove some. */
export function applyItemChange(items: QuoteItem[], add: QuoteItem[], remove: string[]): QuoteItem[] {
  const norm = (s: string) => s.toLowerCase().replace(/s\b/g, "").replace(/\s+/g, " ").trim();
  const rm = new Set(remove.map(norm));
  const out = items.filter((i) => !rm.has(norm(i.name))).map((i) => ({ ...i }));
  for (const a of add) {
    const hit = out.find((i) => norm(i.name) === norm(a.name));
    if (hit && a.quantity != null) hit.quantity = (hit.quantity ?? 0) + a.quantity;
    else if (!hit && (a.quantity == null || a.quantity > 0)) out.push({ ...a });
  }
  // Taking away all of an item removes it.
  return out.filter((i) => i.quantity == null || i.quantity > 0);
}

// ---------- Goodshuffle links ----------

export const GOODSHUFFLE_HOME = "https://pro.goodshuffle.com/app";

/** Only links that open Goodshuffle Pro itself are accepted on a card. */
export function cleanGoodshuffleUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "pro.goodshuffle.com" || u.username || u.password) return null;
  return u.toString();
}

// ---------- Delivery days (Leo's rules, Nov 18) ----------

export interface DeliveryFacts {
  event_date: string | null; // YYYY-MM-DD
  venue_type: "home" | "venue" | null;
  event_start: string | null; // "HH:MM" 24h, if known
  same_day_dropoff: boolean; // customer asked for drop-off on the event day
  same_night_pickup: boolean; // customer asked for pickup the night of the event
  saturday_pickup: boolean; // customer asked for a Saturday pickup
  exact_time: boolean; // customer asked for an exact delivery time
  stage_or_dance_floor: boolean;
  north_jersey: boolean | null;
}

export const EMPTY_FACTS: DeliveryFacts = {
  event_date: null,
  venue_type: null,
  event_start: null,
  same_day_dropoff: false,
  same_night_pickup: false,
  saturday_pickup: false,
  exact_time: false,
  stage_or_dance_floor: false,
  north_jersey: null,
};

export interface DeliveryPlan {
  dropoff: string;
  pickup: string;
  fee: string;
  flags: string[]; // things Leo must decide or price before the quote goes out
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ALL_DAY = "8 AM to 6 PM";
const MORNING = "8 AM to 12 PM";

function parseDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}
const add = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const fmt = (d: Date) => `${DAY[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
const either = (a: Date, b: Date, w?: string) => `${fmt(a)} or ${fmt(b)}${w ? `, ${w}` : ""}`;
const one = (a: Date, w: string) => `${fmt(a)}, ${w}`;

/** Thanksgiving: the fourth Thursday of November. */
export function isThanksgiving(d: Date) {
  return d.getUTCMonth() === 10 && d.getUTCDay() === 4 && d.getUTCDate() >= 22 && d.getUTCDate() <= 28;
}

export function deliveryPlan(f: DeliveryFacts): DeliveryPlan {
  const flags: string[] = [];
  const date = f.event_date ? parseDate(f.event_date) : null;
  const fee =
    f.venue_type === "home"
      ? "Standard delivery: Goodshuffle's calculated cost for the address."
      : f.venue_type === "venue"
        ? f.stage_or_dance_floor && f.north_jersey
          ? "Exact-time delivery: $250 each way (stage or dance floor to a North Jersey venue)."
          : "Exact-time delivery: Goodshuffle's calculated exact-time cost (Logistics → add a delivery → exact time)."
        : "Depends on home or venue.";
  if (f.venue_type === "venue" && !(f.stage_or_dance_floor && f.north_jersey)) flags.push("Venue delivery price: check the exact-time cost with Leo before sending.");
  if (f.venue_type === "home" && f.exact_time) flags.push("Customer asked for an exact time: add the exact-time surcharge from Goodshuffle.");
  if (f.saturday_pickup) flags.push("Customer asked for a Saturday pickup: ask Leo for the price first.");
  if (f.same_night_pickup) flags.push("Same-night pickup asked for: after-hours fee, usually $200. Confirm with Leo.");

  if (!date) return { dropoff: "Needs the event date.", pickup: "Needs the event date.", fee, flags };
  const dow = date.getUTCDay();

  if (isThanksgiving(date)) {
    return { dropoff: either(add(date, -2), add(date, -1), ALL_DAY), pickup: either(add(date, 1), add(date, 2), ALL_DAY), fee, flags };
  }
  if (!f.venue_type) {
    flags.unshift("Home or venue isn't known yet, so the days below are a guess for a home.");
  }
  const venue = f.venue_type === "venue";

  // Weekend
  if (dow === 6 || dow === 0) {
    if (venue) {
      return { dropoff: one(date, MORNING), pickup: one(add(date, 1), MORNING), fee, flags };
    }
    const thu = add(date, dow === 6 ? -2 : -3);
    const mon = add(date, dow === 6 ? 2 : 1);
    return { dropoff: either(thu, add(thu, 1), ALL_DAY), pickup: either(mon, add(mon, 1), ALL_DAY), fee, flags };
  }
  // Friday
  if (dow === 5) {
    const dropoff = either(add(date, -2), add(date, -1), ALL_DAY);
    return venue
      ? { dropoff, pickup: one(add(date, 1), MORNING), fee, flags }
      : { dropoff, pickup: either(add(date, 3), add(date, 4), ALL_DAY), fee, flags };
  }
  // Midweek (Monday to Thursday)
  let dropoff = one(add(date, -1), ALL_DAY);
  let pickup = one(add(date, 1), ALL_DAY);
  if (f.same_day_dropoff) {
    dropoff = one(date, MORNING);
    const startHour = f.event_start ? Number(f.event_start.split(":")[0]) : null;
    if (startHour == null) flags.push("Same-day drop-off: get the event's start and end times to decide.");
    else if (startHour < 12) flags.push("Event starts early: price an exact-time drop-off instead of the 8 to 12 window.");
  }
  if (f.same_night_pickup) pickup = `${fmt(date)}, after the event (exact time)`;
  return { dropoff, pickup, fee, flags };
}

/** Lines that are on every quote, from Leo's rules. */
export const ALWAYS_ON_QUOTE = [
  "Standard delivery (drop-off and pickup)",
  "Rental Protection Plan (not optional)",
  "No setup unless the customer asked for it",
];
