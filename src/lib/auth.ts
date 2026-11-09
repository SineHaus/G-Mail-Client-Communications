import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "./session";

/** Returns the signed-in user or throws. Use in every server action and route handler. */
export async function requireSession() {
  const s = await verifySessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) throw new Error("Not signed in");
  return s;
}
