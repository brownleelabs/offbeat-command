import AdminDashboard from "@/app/dashboard-client";
import LandingPage from "@/app/landing-page";
import { createServerSupabase } from "@/lib/supabase-server";

/** Opt out of static prerender so auth/Supabase and useSearchParams work at build time. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return <AdminDashboard />;
  return <LandingPage />;
}
