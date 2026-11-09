import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

/** Variables the app can't run without. Names only — values are never shown. */
export const REQUIRED_ENV = [
  "APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GMAIL_PUBSUB_TOPIC",
  "GMAIL_WEBHOOK_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "ALLOWED_EMAILS",
  "SESSION_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "CRON_SECRET",
] as const;

export function missingEnv(): string[] {
  const missing: string[] = REQUIRED_ENV.filter((n) => !process.env[n]?.trim());
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) missing.push("SESSION_SECRET (must be 32+ characters)");
  return missing;
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
