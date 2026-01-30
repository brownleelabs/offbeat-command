/**
 * Server-only auth and Supabase helpers.
 * Import only from server code (e.g. "use server" actions); do not import from client.
 */
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";

const SUPER_ADMIN_ONLY = "Only SUPER_ADMIN can perform this action.";

/**
 * Service-role Supabase client for server-side mutations that bypass RLS.
 * Use only in server actions; never expose to client.
 */
export function getSupabaseService(): ReturnType<typeof createClient> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "[auth-server] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
    return null;
  }
  return createClient(url, key);
}

/**
 * Anon-key Supabase client for server-side reads that respect RLS (e.g. claim flow).
 */
export function getSupabaseAnon(): ReturnType<typeof createClient> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error(
      "[auth-server] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
    return null;
  }
  return createClient(url, key);
}

export function hasServiceRoleKey(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export type RequireSuperAdminResult =
  | { ok: true; userId: string | null }
  | { ok: false; error: string };

/**
 * Require current user to be SUPER_ADMIN. Use for Campaigns, Deal Desk, Settings, Fleet create/delete/fund/audit.
 */
export async function requireSuperAdmin(): Promise<RequireSuperAdminResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = (profile as { role?: string } | null)?.role;
  if (role !== "SUPER_ADMIN") return { ok: false, error: SUPER_ADMIN_ONLY };
  return { ok: true, userId: user.id };
}

export type RequireProfileResult =
  | { ok: true; userId: string; role: string; organizationId: string | null }
  | { ok: false; error: string };

/**
 * Get current user and profile (role, organization_id). Use when you need org scope (e.g. fleet_write).
 */
export async function requireProfile(): Promise<RequireProfileResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();
  const role = (profile as { role?: string; organization_id?: string | null } | null)?.role ?? "";
  const organizationId =
    (profile as { organization_id?: string | null } | null)?.organization_id ?? null;
  return { ok: true, userId: user.id, role, organizationId };
}
