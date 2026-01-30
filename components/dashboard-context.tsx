"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase";
import type { UserProfile, UserRole } from "@/types";

/** DB enum values – must match database. */
const USER_ROLES: readonly UserRole[] = [
  "SUPER_ADMIN",
  "ORG_ADMIN",
  "AUDITOR",
  "STUDENT",
] as const;

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export type ViewMode = "GLOBAL" | "TENANT";

interface DashboardContextValue {
  /** Current user's role from profile, or undefined if no profile loaded. */
  userRole: UserRole | undefined;
  /** Effective org for UI (dropdown selection, labels). For AUDITOR this is still profile.organization_id; for ORG_ADMIN/STUDENT it's their org; for SUPER_ADMIN it's null (GLOBAL) or selectedOrgId (TENANT). */
  orgId: string | null;
  /** Org to use when filtering data (tokens, campaigns, responses). AUDITOR and SUPER_ADMIN in GLOBAL see all (null); ORG_ADMIN/STUDENT and SUPER_ADMIN in TENANT use one org. */
  dataScopeOrgId: string | null;
  /** GLOBAL = see all orgs (SUPER_ADMIN only); TENANT = filter by one org. Non–SUPER_ADMIN are always TENANT. */
  viewMode: ViewMode;
  /** Toggle between GLOBAL and TENANT. No-op unless role === 'SUPER_ADMIN'. */
  toggleViewMode: () => void;
  /** Set view mode (e.g. from Map org filter). Used so SUPER_ADMIN can switch to TENANT when picking an org. */
  setViewMode: (mode: ViewMode) => void;
  /** When viewMode === 'TENANT' and SUPER_ADMIN, the org selected. Ignored for other roles. */
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string | null) => void;
  profile: UserProfile | null;
  loading: boolean;
  /** Set when auth failed (e.g. "Auth session missing!"); use to show session hint. */
  authError: string | null;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }
  return ctx;
}

interface DashboardProviderProps {
  children: ReactNode;
}

export function DashboardProvider({ children }: DashboardProviderProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("GLOBAL");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function fetchProfile() {
      try {
        // Hydrate session from cookies first (helps after redirect with @supabase/ssr)
        await supabase.auth.getSession();

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (cancelled) return;

        if (authError) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[DashboardContext] Auth error:", authError.message);
          }
          setAuthError(authError.message);
          setProfile(null);
          setLoading(false);
          return;
        }
        setAuthError(null);
        if (!user) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[DashboardContext] No auth user");
          }
          setProfile(null);
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("id, email, role, organization_id, first_name, last_name, phone")
          .eq("id", user.id)
          .single();

        if (cancelled) return;

        if (error) {
          if (process.env.NODE_ENV === "development") {
            console.error("[DashboardContext] Profiles fetch error:", {
              message: error.message,
              code: error.code,
              details: error.details,
            });
          }
          setProfile(null);
          setLoading(false);
          return;
        }
        if (!data) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[DashboardContext] Profiles fetch: no data (0 rows)");
          }
          setProfile(null);
          setLoading(false);
          return;
        }

        const raw = data as Record<string, unknown>;
        const role = isUserRole(raw.role) ? raw.role : "STUDENT";
        setAuthError(null);
        setProfile({
          id: String(raw.id),
          email: String(raw.email ?? ""),
          role,
          organization_id: raw.organization_id != null ? String(raw.organization_id) : null,
          first_name: raw.first_name != null ? String(raw.first_name) : null,
          last_name: raw.last_name != null ? String(raw.last_name) : null,
          phone: raw.phone != null ? String(raw.phone) : null,
        });
      } catch (err) {
        if (!cancelled) {
          if (process.env.NODE_ENV === "development") {
            console.error("[DashboardContext] Fetch profile exception:", err);
          }
          setProfile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // Enforce viewMode by role when profile loads or changes
  useEffect(() => {
    if (!profile) return;
    // ORG_ADMIN, AUDITOR, STUDENT: MUST be TENANT (SUPER_ADMIN keeps default GLOBAL or their toggled state)
    if (profile.role !== "SUPER_ADMIN") {
      setViewMode("TENANT");
    }
    // profile object identity intentionally not in deps to avoid toggling on every profile ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role]);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "GLOBAL" ? "TENANT" : "GLOBAL"));
  }, []);

  const effectiveToggleViewMode = useCallback(() => {
    if (profile?.role === "SUPER_ADMIN") {
      toggleViewMode();
    }
  }, [profile?.role, toggleViewMode]);

  // orgId: locked to profile.organization_id for non–SUPER_ADMIN; only SUPER_ADMIN in TENANT uses selectedOrgId
  const orgId = useMemo(() => {
    if (!profile) return null;
    if (profile.role !== "SUPER_ADMIN") {
      return profile.organization_id;
    }
    if (viewMode === "GLOBAL") return null;
    return selectedOrgId;
  }, [profile, viewMode, selectedOrgId]);

  // dataScopeOrgId: for fetching tokens/campaigns/responses. AUDITOR sees all (null); SUPER_ADMIN GLOBAL = null; else orgId
  const dataScopeOrgId = useMemo(() => {
    if (!profile) return null;
    if (profile.role === "AUDITOR") return null;
    return orgId;
  }, [profile, orgId]);

  const value = useMemo<DashboardContextValue>(
    () => ({
      userRole: profile?.role,
      orgId,
      dataScopeOrgId,
      viewMode,
      toggleViewMode: effectiveToggleViewMode,
      setViewMode,
      selectedOrgId,
      setSelectedOrgId,
      profile,
      loading,
      authError,
    }),
    [
      profile,
      orgId,
      dataScopeOrgId,
      viewMode,
      effectiveToggleViewMode,
      setViewMode,
      selectedOrgId,
      loading,
      authError,
    ]
  );

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}
