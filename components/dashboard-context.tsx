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

export type ViewMode = "GLOBAL" | "TENANT";

interface DashboardContextValue {
  /** Current user's role from profile, or undefined if no profile loaded. */
  userRole: UserRole | undefined;
  /** Effective org for filtering: user's org for non–SUPER_ADMIN; selected org in TENANT mode for SUPER_ADMIN; null in GLOBAL for SUPER_ADMIN. */
  orgId: string | null;
  /** GLOBAL = see all orgs (SUPER_ADMIN only); TENANT = filter by one org. */
  viewMode: ViewMode;
  /** Toggle between GLOBAL and TENANT. No-op unless role === 'SUPER_ADMIN'. */
  toggleViewMode: () => void;
  /** When viewMode === 'TENANT' and SUPER_ADMIN, the org currently selected (mock or from UI). */
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string | null) => void;
  /** Raw profile when loaded; null if not signed in or profile missing. */
  profile: UserProfile | null;
  /** True while profile is being fetched. */
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
        setProfile(data as UserProfile);
      } catch {
        if (!cancelled) {
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

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "GLOBAL" ? "TENANT" : "GLOBAL"));
  }, []);

  const effectiveToggleViewMode = useCallback(() => {
    if (profile?.role === "SUPER_ADMIN") {
      toggleViewMode();
    }
  }, [profile?.role, toggleViewMode]);

  const orgId = useMemo(() => {
    if (!profile) return null;
    if (profile.role !== "SUPER_ADMIN") return profile.organization_id;
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
