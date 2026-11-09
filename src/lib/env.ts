import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

export const env = {
  appUrl: () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  googleClientId: () => req("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => req("GOOGLE_CLIENT_SECRET"),
  pubsubTopic: () => process.env.GMAIL_PUBSUB_TOPIC ?? "",
  webhookToken: () => req("GMAIL_WEBHOOK_TOKEN"),
  cronSecret: () => process.env.CRON_SECRET ?? "",
  supabaseUrl: () => req("SUPABASE_URL"),
  supabaseServiceKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),
  allowedEmails: () =>
    req("ALLOWED_EMAILS")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  anthropicModel: () => process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  draftLookbackDays: () => Number(process.env.DRAFT_LOOKBACK_DAYS ?? "3"),
};
