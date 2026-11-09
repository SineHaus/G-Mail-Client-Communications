import "server-only";
import { db } from "./db";
import { env } from "./env";
import { Gmail } from "./google";

/** Start/renew Gmail push notifications to the Pub/Sub topic (expires after 7 days). */
export async function startWatch() {
  const topic = env.pubsubTopic();
  if (!topic) return { ok: false as const, reason: "GMAIL_PUBSUB_TOPIC is not set" };
  const w = await Gmail.watch(topic);
  await db()
    .from("gmail_account")
    .update({ watch_expires_at: new Date(Number(w.expiration)).toISOString() })
    .eq("id", 1);
  return { ok: true as const, expiration: w.expiration };
}
