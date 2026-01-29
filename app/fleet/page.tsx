import { redirect } from "next/navigation";

/**
 * Deprecated: Fleet is only available in the dashboard with org context and RBAC.
 * Redirect to dashboard with Fleet tab selected.
 */
export default function FleetPage() {
  redirect("/?tab=fleet");
}
