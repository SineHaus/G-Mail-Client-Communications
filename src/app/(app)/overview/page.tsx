import { redirect } from "next/navigation";

// Overview's projects list and filters moved to Quotes in the new layout.
export default function OverviewPage() {
  redirect("/quotes");
}
