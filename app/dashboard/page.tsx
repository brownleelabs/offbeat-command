import { redirect } from "next/navigation";

/**
 * Dashboard is rendered at root (/). Redirect so /dashboard works for links and bookmarks.
 */
export default function DashboardPage() {
  redirect("/");
}
