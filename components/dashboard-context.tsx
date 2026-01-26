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
  /** Effective org for filtering: locked to profile.organization_id for non–SUPER_ADMIN; selected org in TENANT for SUPER_ADMIN; null in GLOBAL for SUPER_ADMIN. */
  orgId: string | null;
  /** GLOBAL = see all orgs (SUPER_ADMIN only); TENANT = filter by one org. Non–SUPER_ADMIN are always TENANT. */
  viewMode: ViewMode;
  /** Toggle between GLOBAL and TENANT. No-op unless role === 'SUPER_ADMIN'. */
  toggleViewMode: () => void;
  /** When viewMode === 'TENANT' and SUPER_ADMIN, the org selected. Ignored for other roles. */
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string | null) => void;
  profile: UserProfile | null;
  loading: boolean;
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
  const [viewMode, setViewMode] = useState<ViewMode>("GLOBAL");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function fetchProfile() {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authError || !user) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const { data, error } = await supabase
          .from("profiles")
          .select("id, email, role, organization_id")
          .eq("id", user.id)
          .single();
        if (cancelled) return;
        if (error || !data) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const raw = data as Record<string, unknown>;
        const role = isUserRole(raw.role) ? raw.role : "STUDENT";
        setProfile({
          id: String(raw.id),
          email: String(raw.email ?? ""),
          role,
          organization_id: raw.organization_id != null ? String(raw.organization_id) : null,
        });
      } catch {
        if (!cancelled) setProfile(null);
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

  const value = useMemo<DashboardContextValue>(
    () => ({
      userRole: profile?.role,
      orgId,
      viewMode,
      toggleViewMode: effectiveToggleViewMode,
      selectedOrgId,
      setSelectedOrgId,
      profile,
      loading,
    }),
    [
      profile,
      orgId,
      viewMode,
      effectiveToggleViewMode,
      selectedOrgId,
      loading,
    ]
  );

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}
