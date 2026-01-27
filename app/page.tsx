import AdminDashboard from "@/app/dashboard-client";

/** Opt out of static prerender so auth/Supabase and useSearchParams work at build time. */
export const dynamic = "force-dynamic";

export default function HomePage() {
  return <AdminDashboard />;
}
