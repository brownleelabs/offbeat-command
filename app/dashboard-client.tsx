"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, ArrowUp, ArrowDown } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useDashboard, type ViewMode } from "@/components/dashboard-context";

const MapView = dynamic(() => import("@/components/map-view"), { ssr: false });
import {
  ROLE_PERMISSION_KEYS,
  CONTROLLABLE_ROLES,
  type RolePermissionRow,
} from "@/lib/constants";
import {
  bulkAssignTokensToSchool,
  getRolePermissions,
  setRolePermission,
} from "@/app/actions";
import type { Campaign, TokenWithCampaign, DealScenario } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignQuestion } from "@/types";
import { CAMPAIGN_REQUIRED_FIELDS } from "@/types";

/** Campus/tenant entity. In the DB: table `organizations`. Public-facing UI uses "school" (e.g. /schools); Command Center uses "organization". */
type Organization = { id: string; name: string };

type Tab = "map" | "fleet" | "campaigns" | "settings" | "pricing";

/** Effective write flags for current user. SUPER_ADMIN = all true; else from role_permissions. */
function getEffectivePermissions(
  userRole: string | undefined,
  rows: RolePermissionRow[]
): { fleetWrite: boolean; campaignsWrite: boolean; mapReset: boolean } {
  if (userRole === "SUPER_ADMIN") {
    return { fleetWrite: true, campaignsWrite: true, mapReset: true };
  }
  const map = new Map<string, boolean>();
  rows.forEach((r) => map.set(`${r.role}:${r.permission_key}`, r.enabled));
  return {
    fleetWrite: map.get(`${userRole}:fleet_write`) ?? false,
    campaignsWrite: map.get(`${userRole}:campaigns_write`) ?? false,
    mapReset: map.get(`${userRole}:map_reset`) ?? false,
  };
}

const MAX_QUESTIONS = 10;

/** Normalize raw token rows so Fleet tab always has TokenWithCampaign shape (lat/lng, campaigns, organizations). */
function normalizeTokensWithCampaign(rows: unknown[]): TokenWithCampaign[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const lat = (r.lat as number) ?? (r.latitude as number) ?? 0;
    const lng = (r.lng as number) ?? (r.longitude as number) ?? 0;
    const org = (r.organizations ?? r.organization) as { name: string } | null | undefined;
    return {
      id: String(r.id),
      lat: Number(lat),
      lng: Number(lng),
      status: (r.status === "found" ? "found" : "active") as "active" | "found",
      organization_id: (r.organization_id as string) ?? null,
      campaign_id: (r.campaign_id as string) ?? null,
      campaigns: (r.campaigns as { name: string } | null) ?? null,
      organizations: org ?? null,
    };
  });
}

const ADMIN_ROLES = ["SUPER_ADMIN", "ORG_ADMIN", "AUDITOR"] as const;
function isAdminRole(role: string | undefined): role is (typeof ADMIN_ROLES)[number] {
  return role != null && (ADMIN_ROLES as readonly string[]).includes(role);
}

export default function AdminDashboard() {
  const { viewMode, toggleViewMode, userRole, orgId, dataScopeOrgId, loading, profile, authError } = useDashboard();
  const searchParams = useSearchParams();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("map");

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "map" || tab === "fleet" || tab === "campaigns" || tab === "settings" || tab === "pricing") setActiveTab(tab);
  }, [searchParams]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tokens, setTokens] = useState<TokenWithCampaign[]>([]);
  const [responsesCount, setResponsesCount] = useState<number>(0);
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(new Set());
  const [targetCampaignId, setTargetCampaignId] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [targetSchoolId, setTargetSchoolId] = useState("");
  const [assignToSchoolMessage, setAssignToSchoolMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [rolePermissions, setRolePermissions] = useState<RolePermissionRow[]>([]);
  const [showArchivedCampaigns, setShowArchivedCampaigns] = useState(false);

  const supabase = createClient();
  const effectivePermissions = getEffectivePermissions(userRole, rolePermissions);

  // Fetch role_permissions for permission-based UI (all admins need to know their write access)
  useEffect(() => {
    if (!isAdminRole(userRole)) return;
    getRolePermissions().then(setRolePermissions);
  }, [userRole]);

  // Fetch organizations of type 'school' only (Super Admin dropdowns: Create Campaign + Fleet assign). Never show 'institution'.
  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") return;
    let cancelled = false;
    const client = createClient();
    client
      .from("organizations")
      .select("id, name")
      .eq("type", "school")
      .order("name")
      .then(({ data }) => {
        if (!cancelled && data) setOrganizations((data as Organization[]) ?? []);
      });
    return () => { cancelled = true; };
  }, [userRole]);

  // Fetch organization name when we have orgId and need it for display (ORG_ADMIN). AUDITOR shows "All (read-only)"; SUPER_ADMIN GLOBAL uses view mode label.
  useEffect(() => {
    if (userRole === "AUDITOR") {
      setOrgName("All (read-only)");
      return;
    }
    if (!orgId || !userRole) return;
    if (userRole === "SUPER_ADMIN" && viewMode === "GLOBAL") return;
    let cancelled = false;
    const client = createClient();
    (async () => {
      const { data } = await client
        .from("organizations")
        .select("name")
        .eq("id", orgId)
        .single();
      if (!cancelled && data && typeof data === "object" && "name" in data) {
        setOrgName(String((data as { name: string }).name));
      } else if (!cancelled) {
        setOrgName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, userRole, viewMode]);

  const loadData = useCallback(async () => {
    const filterOrgId = dataScopeOrgId;

    let campaignsQuery = supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (!showArchivedCampaigns) {
      campaignsQuery = campaignsQuery.is("deleted_at", null);
    }
    if (filterOrgId != null) {
      campaignsQuery = campaignsQuery.eq("organization_id", filterOrgId);
    }
    const { data: cData } = await campaignsQuery;
    setCampaigns((cData as Campaign[]) ?? []);

    let tokensQuery = supabase
      .from("tokens")
      .select("*, campaigns(name), organizations(name)")
      .order("id");
    if (filterOrgId != null) {
      tokensQuery = tokensQuery.eq("organization_id", filterOrgId);
    }
    const { data: tData, error } = await tokensQuery;
    if (!error && tData) {
      setTokens(normalizeTokensWithCampaign(tData));
    } else {
      if (error) {
        console.warn("Fleet join failed, loading tokens only:", error.message);
      }
      let tokensOnlyQuery = supabase.from("tokens").select("*").order("id");
      if (filterOrgId != null) {
        tokensOnlyQuery = tokensOnlyQuery.eq("organization_id", filterOrgId);
      }
      const { data: tokensOnly } = await tokensOnlyQuery;
      setTokens(normalizeTokensWithCampaign(tokensOnly ?? []));
    }

    let responsesQuery = supabase
      .from("responses")
      .select("*", { count: "exact", head: true });
    if (filterOrgId != null) {
      responsesQuery = responsesQuery.eq("organization_id", filterOrgId);
    }
    const { count } = await responsesQuery;
    setResponsesCount(count ?? 0);
  }, [dataScopeOrgId, showArchivedCampaigns]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ORG_ADMIN: keep targetSchoolId in sync with their org so "Assign to my organization" works
  useEffect(() => {
    if (userRole === "ORG_ADMIN" && profile?.organization_id) {
      setTargetSchoolId(profile.organization_id);
    }
  }, [userRole, profile?.organization_id]);

  // Realtime: keep Fleet, Stats, and Map in sync when tokens or responses change (no refresh needed)
  useEffect(() => {
    if (!isAdminRole(userRole)) return;
    const channel = supabase
      .channel("dashboard-live")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tokens",
          ...(dataScopeOrgId != null ? { filter: `organization_id=eq.${dataScopeOrgId}` } : {}),
        },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new;
          const incomingOrgId = row.organization_id as string | null | undefined;
          if (dataScopeOrgId != null && incomingOrgId !== dataScopeOrgId) return;
          setTokens((prev) => {
            const next = normalizeTokensWithCampaign([row]);
            const token = next[0];
            if (!token) return prev;
            const idx = prev.findIndex((t) => t.id === token.id);
            if (idx >= 0) {
              const out = [...prev];
              const oldToken = prev[idx];
              // If campaign_id changed, don't preserve old campaigns data (it's stale)
              // Realtime updates don't include joined data, so token.campaigns will be null
              const campaignIdChanged = oldToken.campaign_id !== token.campaign_id;
              let campaigns: { name: string } | null = null;
              if (campaignIdChanged) {
                // Campaign ID changed - clear stale data immediately
                // Realtime updates don't include joined data, so token.campaigns will be null
                campaigns = null;
                // Fetch new campaign data asynchronously (only if campaign_id is not null)
                if (token.campaign_id) {
                  (async () => {
                    try {
                      const { data } = await supabase
                        .from("campaigns")
                        .select("name")
                        .eq("id", token.campaign_id)
                        .single();
                      if (data) {
                        setTokens((current) => {
                          const currentIdx = current.findIndex((t) => t.id === token.id);
                          // Verify campaign_id hasn't changed again before updating
                          if (currentIdx >= 0 && current[currentIdx].campaign_id === token.campaign_id) {
                            const updated = [...current];
                            updated[currentIdx] = {
                              ...updated[currentIdx],
                              campaigns: { name: (data as { name: string }).name },
                            };
                            return updated;
                          }
                          return current;
                        });
                      }
                    } catch (err) {
                      console.warn("[Fleet] Failed to fetch campaign for updated token:", err);
                    }
                  })();
                }
                // If campaign_id is null (unassigned), campaigns stays null (correct)
              } else {
                // Campaign ID unchanged - preserve existing campaigns data if available
                campaigns = token.campaigns ?? oldToken.campaigns ?? null;
              }
              // Preserve organizations (it doesn't change via campaign assignment)
              out[idx] = { ...token, campaigns, organizations: oldToken.organizations ?? null };
              return out;
            }
            return [...prev, token];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tokens",
          ...(dataScopeOrgId != null ? { filter: `organization_id=eq.${dataScopeOrgId}` } : {}),
        },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new;
          const incomingOrgId = row.organization_id as string | null | undefined;
          if (dataScopeOrgId != null && incomingOrgId !== dataScopeOrgId) return;
          setTokens((prev) => {
            const next = normalizeTokensWithCampaign([row]);
            const token = next[0];
            if (!token || prev.some((t) => t.id === token.id)) return prev;
            return [...prev, token];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "responses",
          ...(dataScopeOrgId != null ? { filter: `organization_id=eq.${dataScopeOrgId}` } : {}),
        },
        (payload: { new: { organization_id?: string | null } }) => {
          const row = payload.new;
          if (dataScopeOrgId != null && row.organization_id !== dataScopeOrgId) return;
          setResponsesCount((c) => c + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userRole, dataScopeOrgId, supabase]);

  const UNASSIGN_CAMPAIGN_VALUE = "__unassign__";
  async function assignTokens() {
    if (selectedTokenIds.size === 0) return;
    if (targetCampaignId !== UNASSIGN_CAMPAIGN_VALUE && !targetCampaignId) return;
    const payload = targetCampaignId === UNASSIGN_CAMPAIGN_VALUE ? { campaign_id: null } : { campaign_id: targetCampaignId };
    const { error } = await supabase
      .from("tokens")
      .update(payload)
      .in("id", Array.from(selectedTokenIds));
    if (!error) {
      setSelectedTokenIds(new Set());
      setTargetCampaignId("");
      loadData();
    }
  }

  async function assignTokensToSchool() {
    if (!targetSchoolId.trim() || selectedTokenIds.size === 0) return;
    setAssignToSchoolMessage(null);
    const result = await bulkAssignTokensToSchool(Array.from(selectedTokenIds), targetSchoolId);
    if (result.success) {
      setAssignToSchoolMessage({ type: "success", text: `${result.count} token(s) assigned to organization.` });
      setSelectedTokenIds(new Set());
      loadData();
    } else {
      setAssignToSchoolMessage({ type: "error", text: result.error });
    }
  }

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login"; // Force full reload to clear state
  };

  // 1. Loading state
  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-950 font-mono text-emerald-500">
        AUTHENTICATING...
      </div>
    );
  }

  // 2. Missing profile or auth session error
  if (!profile) {
    const isSessionMissing =
      authError?.toLowerCase().includes("session missing") ?? false;
    const isLikelyVercelOrigin =
      typeof window !== "undefined" &&
      (window.location.hostname.endsWith(".vercel.app") || window.location.hostname === "vercel.app");
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-zinc-950 px-4 text-center text-white">
        {isSessionMissing ? (
          <>
            <h1 className="text-xl font-bold text-red-500">AUTH SESSION MISSING</h1>
            {isLikelyVercelOrigin ? (
              <p className="max-w-md text-zinc-400">
                On Vercel, Supabase Auth can return 403 if this deployment URL is not allowed. In Supabase
                Dashboard → Authentication → URL Configuration, add this site to <strong>Redirect URLs</strong> and
                set <strong>Site URL</strong> to your production or preview URL, then sign in again.
              </p>
            ) : (
              <p className="max-w-md text-zinc-400">
                Your browser or an extension (e.g. MetaMask, Lockdown) may be blocking
                the auth session. Try: open this site in a private/incognito window, or
                disable that extension for this site, then sign in again.
              </p>
            )}
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <a
                href="/login"
                className="rounded border border-zinc-700 px-4 py-2 hover:bg-zinc-800"
              >
                SIGN IN AGAIN
              </a>
              <button
                type="button"
                onClick={() => {
                  window.location.href = "/";
                }}
                className="rounded border border-zinc-600 px-4 py-2 text-zinc-300 hover:bg-zinc-800"
              >
                Try full page reload
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-red-500">NO PROFILE FOUND</h1>
            <p className="text-zinc-400">User authenticated, but no profile row exists.</p>
            {authError && (
              <p className="text-xs text-zinc-500">Auth error: {authError}</p>
            )}
            <button
              type="button"
              onClick={() => {
                createClient().auth.signOut();
                window.location.href = "/login";
              }}
              className="rounded border border-zinc-700 px-4 py-2 hover:bg-zinc-800"
            >
              FORCE LOGOUT
            </button>
          </>
        )}
      </div>
    );
  }

  // 3. Student gate – do not render admin dashboard
  if (userRole === "STUDENT") {
    return (
      <StudentPlaceholder
        orgName={orgName ?? "your organization"}
        onLogout={handleLogout}
      />
    );
  }

  // 4. Admin view (SUPER_ADMIN, ORG_ADMIN, AUDITOR)
  if (!isAdminRole(userRole)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {userRole === "SUPER_ADMIN" && (
        <div className="border-b border-accent/20 bg-muted p-2 text-center">
          <button
            type="button"
            onClick={toggleViewMode}
            className="text-xs font-mono text-primary"
          >
            VIEW MODE: {viewMode} (CLICK TO SWITCH)
          </button>
        </div>
      )}
      {userRole !== "SUPER_ADMIN" && (
        <div className="border-b border-accent/20 bg-muted p-2 text-center text-xs font-mono text-muted-foreground">
          Organization: {orgName ?? "—"}
        </div>
      )}
      <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-accent bg-muted px-8 py-4">
        <h1 className="text-xl font-bold tracking-tighter text-primary">
          Campus Mobility Project Control Center
        </h1>
        <div className="flex rounded-lg border border-accent bg-background p-1">
          <button
            onClick={() => {
              setActiveTab("map");
              loadData();
            }}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "map" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            MAP
          </button>
          <button
            onClick={() => {
              setActiveTab("fleet");
              loadData();
            }}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "fleet" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            FLEET
          </button>
          <button
            onClick={() => setActiveTab("campaigns")}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "campaigns" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            CAMPAIGNS
          </button>
          {userRole === "SUPER_ADMIN" && (
            <>
              <button
                onClick={() => setActiveTab("pricing")}
                className={`rounded-md px-6 py-2 transition ${
                  activeTab === "pricing" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                PRICING
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className={`rounded-md px-6 py-2 transition ${
                  activeTab === "settings" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                SETTINGS
              </button>
            </>
          )}
        </div>
        <div className="flex w-32 items-center justify-end gap-4 font-mono text-xs uppercase text-muted-foreground">
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs font-mono uppercase text-muted-foreground transition-colors hover:text-destructive"
          >
            LOGOUT
          </button>
          <span>Ver 2.0.1</span>
        </div>
      </nav>

      <main className="p-0">
        <SystemStatus />
        <ExecutiveStats
          viewMode={viewMode}
          tokens={tokens}
          responsesCount={responsesCount}
        />
        {/* Map access is not RBAC; only which tokens are shown is (MapView filters by orgId). canReset is the only permission on the map (Reset button). */}
        {activeTab === "map" && (
          <div className="flex w-full flex-1 flex-col min-h-[480px]" style={{ height: "calc(100vh - 72px - 8rem)" }}>
            <MapView mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN} canReset={effectivePermissions.mapReset} />
          </div>
        )}

        {activeTab === "fleet" && (
          <FleetTab
            tokens={tokens}
            campaigns={campaigns.filter((c) => !c.deleted_at)}
            selectedTokenIds={selectedTokenIds}
            setSelectedTokenIds={setSelectedTokenIds}
            targetCampaignId={targetCampaignId}
            setTargetCampaignId={setTargetCampaignId}
            onAssign={assignTokens}
            onRefresh={loadData}
            orgId={orgId}
            userRole={userRole}
            profile={profile}
            organizations={organizations}
            targetSchoolId={targetSchoolId}
            setTargetSchoolId={setTargetSchoolId}
            onAssignToSchool={assignTokensToSchool}
            assignToSchoolMessage={assignToSchoolMessage}
            fleetWrite={effectivePermissions.fleetWrite}
          />
        )}

        {activeTab === "campaigns" && (
          <CampaignsTab
            campaigns={campaigns}
            onRefresh={loadData}
            supabase={supabase}
            orgId={orgId}
            organizations={organizations}
            userRole={userRole}
            campaignsWrite={effectivePermissions.campaignsWrite}
            showArchivedCampaigns={showArchivedCampaigns}
            setShowArchivedCampaigns={setShowArchivedCampaigns}
          />
        )}

        {activeTab === "pricing" && userRole === "SUPER_ADMIN" && (
          <PricingTab supabase={supabase} />
        )}

        {activeTab === "settings" && userRole === "SUPER_ADMIN" && (
          <SettingsTab
            rolePermissions={rolePermissions}
            onRefresh={() => getRolePermissions().then(setRolePermissions)}
          />
        )}
      </main>
    </div>
  );
}

function StudentPlaceholder({
  orgName,
  onLogout,
}: {
  orgName: string;
  onLogout: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-accent bg-muted p-8 text-center">
        <h1 className="mb-2 text-xl font-bold text-primary">Student Access</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          You are logged in as a student at {orgName}. The Student App is coming
          soon.
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="rounded bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:opacity-90"
        >
          Logout
        </button>
      </div>
    </div>
  );
}

/** Mock value per active token for Campus Liquidity (TENANT). */
const MOCK_USD_PER_ACTIVE_TOKEN = 100;
/** Mock 4.5% APY for Yield Earned (TENANT). */
const TENANT_APY = 0.045;

/** Economic Operating Zone definitions from economic_engine.md */
export type EconomicZone = {
  id: 1 | 2 | 3 | 4;
  name: "Normal" | "Steady" | "Efficient" | "Freeze";
  rateRange: string;
  description: string;
  operatorFee: string;
  color: "emerald" | "amber" | "orange" | "red";
  pulse: boolean; // true = animate-pulse, false = solid
};

/**
 * Determines the Economic Operating Zone based on current yield rate.
 * Source: economic_engine.md - Economic Operating Zones (System Status)
 * 
 * @param yieldRate - Current yield rate as a percentage (e.g., 4.2 for 4.2%)
 * @returns EconomicZone object with zone details
 */
export function getEconomicZone(yieldRate: number): EconomicZone {
  if (yieldRate > 2.0) {
    return {
      id: 1,
      name: "Normal",
      rateRange: "> 2.0%",
      description: "Full Capacity. Operator fee paid at 12%. Surplus flows to growth.",
      operatorFee: "12%",
      color: "emerald",
      pulse: true,
    };
  } else if (yieldRate >= 1.5 && yieldRate <= 2.0) {
    return {
      id: 2,
      name: "Steady",
      rateRange: "1.5% - 2.0%",
      description: "Fee Sacrifice. Operator fee reduced to subsidize payouts. Goal: Maintain 100% student welfare.",
      operatorFee: "Reduced",
      color: "amber",
      pulse: true,
    };
  } else if (yieldRate >= 0.1 && yieldRate < 1.5) {
    return {
      id: 3,
      name: "Efficient",
      rateRange: "0.1% - 1.5%",
      description: "Welfare Throttling. Operator fee waived (0%). Reinvestment paused. 100% yield to students. Token issuance throttled.",
      operatorFee: "0% (Waived)",
      color: "orange",
      pulse: true,
    };
  } else {
    // yieldRate < 0.1% (includes 0.0%)
    return {
      id: 4,
      name: "Freeze",
      rateRange: "0.0%",
      description: "Hard Stop. Token issuance halts. Principal is never liquidated.",
      operatorFee: "N/A",
      color: "red",
      pulse: false, // Solid red, no pulse
    };
  }
}

/** Mock current yield rate (4.2% = Zone 1 Normal). Replace with real API hook later. */
const MOCK_CURRENT_YIELD = 4.2;

function SystemStatus() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTooltip, setShowTooltip] = useState(false);

  // TODO: Replace with real API hook when Franklin Benji integration is ready
  const currentYield = MOCK_CURRENT_YIELD;
  const zone = getEconomicZone(currentYield);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const timeString = currentTime.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Color mapping based on zone
  const dotColorClasses = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
  };

  const textColorClasses = {
    emerald: "text-emerald-500/80",
    amber: "text-amber-500/80",
    orange: "text-orange-500/80",
    red: "text-red-500/80",
  };

  const dotColor = dotColorClasses[zone.color];
  const textColor = textColorClasses[zone.color];
  const pulseClass = zone.pulse ? "animate-pulse" : "";

  return (
    <div className="relative z-10 flex items-center justify-between border-b border-white/5 bg-slate-900/40 px-6 py-2 backdrop-blur-sm">
      <div className="relative">
        <div
          className="flex items-center gap-2 text-xs font-mono cursor-help"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <div className={`h-2 w-2 rounded-full ${dotColor} ${pulseClass}`} />
          <span className={textColor}>
            System: {zone.name}
          </span>
        </div>
        {showTooltip && (
          <div className="absolute left-0 top-6 z-[100] w-80 rounded-lg border border-white/10 bg-slate-900 p-3 text-xs shadow-xl backdrop-blur-sm">
            <div className="font-mono font-semibold text-white">
              Zone {zone.id}: {zone.name}
            </div>
            <div className="mt-1 text-slate-400">
              <div>Rate Range: {zone.rateRange}</div>
              <div className="mt-1">{zone.description}</div>
              <div className="mt-1 font-mono">Operator Fee: {zone.operatorFee}</div>
              <div className="mt-1 text-slate-500">Current Yield: {currentYield.toFixed(1)}%</div>
            </div>
          </div>
        )}
      </div>
      <div className="text-xs font-mono text-slate-500">
        Updated: {timeString}
      </div>
    </div>
  );
}

function ExecutiveStats({
  viewMode,
  tokens,
  responsesCount,
}: {
  viewMode: ViewMode;
  tokens: TokenWithCampaign[];
  responsesCount: number;
}) {
  const activeCount = tokens.filter((t) => t.status === "active").length;
  const campusLiquidity =
    activeCount * MOCK_USD_PER_ACTIVE_TOKEN;
  const yieldEarned = Math.round(campusLiquidity * TENANT_APY);

  // Mock trend data (until backend is ready)
  const globalAumTrend = { value: 2.4, positive: true };
  const treasuryYieldTrend = { value: 12.1, positive: true };
  const activeCampusesTrend = { value: 0, positive: true };

  if (viewMode === "GLOBAL") {
    return (
      <div className="grid grid-cols-1 gap-4 border-b border-white/5 bg-slate-900/40 px-6 py-6 backdrop-blur-sm md:grid-cols-3">
        {/* Global AUM Card */}
        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-widest text-muted-foreground">
            Global AUM
          </h3>
          <p className="font-mono text-2xl font-bold text-white">$1.2M</p>
          <div className="mt-1 flex items-center gap-2">
            {globalAumTrend.positive ? (
              <ArrowUp className="h-3 w-3 text-emerald-400" />
            ) : (
              <ArrowDown className="h-3 w-3 text-red-400" />
            )}
            <span
              className={`text-xs font-mono ${
                globalAumTrend.positive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {globalAumTrend.positive ? "+" : ""}
              {globalAumTrend.value}%
            </span>
            <span className="text-xs text-slate-500">vs last month</span>
          </div>
        </div>

        {/* Net Treasury Yield Card */}
        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-widest text-muted-foreground">
            Net Treasury Yield
          </h3>
          <p className="font-mono text-2xl font-bold tabular-nums text-white">
            +$4,250
          </p>
          <div className="mt-1 flex items-center gap-2">
            {treasuryYieldTrend.positive ? (
              <ArrowUp className="h-3 w-3 text-emerald-400" />
            ) : (
              <ArrowDown className="h-3 w-3 text-red-400" />
            )}
            <span
              className={`text-xs font-mono ${
                treasuryYieldTrend.positive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {treasuryYieldTrend.positive ? "+" : ""}
              {treasuryYieldTrend.value}%
            </span>
            <span className="text-xs text-slate-500">vs last month</span>
          </div>
        </div>

        {/* Active Campuses Card */}
        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-widest text-muted-foreground">
            Active Campuses
          </h3>
          <p className="font-mono text-2xl font-bold text-white">12</p>
          <div className="mt-1 flex items-center gap-2">
            {activeCampusesTrend.positive ? (
              <ArrowUp className="h-3 w-3 text-emerald-400" />
            ) : (
              <ArrowDown className="h-3 w-3 text-red-400" />
            )}
            <span
              className={`text-xs font-mono ${
                activeCampusesTrend.positive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {activeCampusesTrend.positive ? "+" : ""}
              {activeCampusesTrend.value}
            </span>
            <span className="text-xs text-slate-500">Stable</span>
          </div>
        </div>
      </div>
    );
  }

  // TENANT view - mock trends for tenant metrics
  const campusLiquidityTrend = { value: 5.2, positive: true };
  const yieldEarnedTrend = { value: 8.3, positive: true };
  const activeFleetTrend = { value: 3, positive: true };

  return (
    <div className="grid grid-cols-1 gap-4 border-b border-white/5 bg-slate-900/40 px-6 py-6 backdrop-blur-sm md:grid-cols-3">
      {/* Campus Liquidity Card */}
      <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-widest text-muted-foreground">
          Campus Liquidity
        </h3>
        <p className="font-mono text-2xl font-bold text-white">
          ${campusLiquidity.toLocaleString("en-US")}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {campusLiquidityTrend.positive ? (
            <ArrowUp className="h-3 w-3 text-emerald-400" />
          ) : (
            <ArrowDown className="h-3 w-3 text-red-400" />
          )}
          <span
            className={`text-xs font-mono ${
              campusLiquidityTrend.positive ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {campusLiquidityTrend.positive ? "+" : ""}
            {campusLiquidityTrend.value}%
          </span>
          <span className="text-xs text-slate-500">vs last 30 days</span>
        </div>
      </div>

      {/* Yield Earned Card */}
      <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-widest text-muted-foreground">
          Yield Earned
        </h3>
        <p className="font-mono text-2xl font-bold tabular-nums text-white">
          +${yieldEarned.toLocaleString("en-US")}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {yieldEarnedTrend.positive ? (
            <ArrowUp className="h-3 w-3 text-emerald-400" />
          ) : (
            <ArrowDown className="h-3 w-3 text-red-400" />
          )}
          <span
            className={`text-xs font-mono ${
              yieldEarnedTrend.positive ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {yieldEarnedTrend.positive ? "+" : ""}
            {yieldEarnedTrend.value}%
          </span>
          <span className="text-xs text-slate-500">(4.5% APY) vs last 30 days</span>
        </div>
      </div>

      {/* Active Fleet Card */}
      <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-widest text-muted-foreground">
          Active Fleet
        </h3>
        <p className="font-mono text-2xl font-bold text-white">
          {activeCount}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {activeFleetTrend.positive ? (
            <ArrowUp className="h-3 w-3 text-emerald-400" />
          ) : (
            <ArrowDown className="h-3 w-3 text-red-400" />
          )}
          <span
            className={`text-xs font-mono ${
              activeFleetTrend.positive ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {activeFleetTrend.positive ? "+" : ""}
            {activeFleetTrend.value}
          </span>
          <span className="text-xs text-slate-500">vs last 30 days</span>
        </div>
      </div>
    </div>
  );
}

function FleetTab({
  tokens,
  campaigns,
  selectedTokenIds,
  setSelectedTokenIds,
  targetCampaignId,
  setTargetCampaignId,
  onAssign,
  onRefresh,
  orgId,
  userRole,
  profile,
  organizations,
  targetSchoolId,
  setTargetSchoolId,
  onAssignToSchool,
  assignToSchoolMessage,
  fleetWrite,
}: {
  tokens: TokenWithCampaign[];
  campaigns: Campaign[];
  selectedTokenIds: Set<string>;
  setSelectedTokenIds: (s: Set<string>) => void;
  targetCampaignId: string;
  setTargetCampaignId: (id: string) => void;
  onAssign: () => void;
  onRefresh: () => void;
  orgId: string | null;
  userRole: string | undefined;
  profile: { role: string; organization_id: string | null } | null;
  organizations: Organization[];
  targetSchoolId: string;
  setTargetSchoolId: (id: string) => void;
  onAssignToSchool: () => void;
  assignToSchoolMessage: { type: "success" | "error"; text: string } | null;
  fleetWrite: boolean;
}) {
  const toggleOne = (id: string) => {
    const next = new Set(selectedTokenIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTokenIds(next);
  };
  const toggleAll = (checked: boolean) => {
    setSelectedTokenIds(checked ? new Set(tokens.map((t) => t.id)) : new Set());
  };
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const isAuditor = userRole === "AUDITOR";
  const showFleetWrite = (fleetWrite || isSuperAdmin) && !isAuditor;
  const showOrgColumn = isSuperAdmin || isAuditor;
  const canAssignToSchool = isSuperAdmin || (userRole === "ORG_ADMIN" && !!profile?.organization_id);

  return (
    <div className="mx-auto max-w-[98vw] px-4 py-8 font-sans">
      {/* Control Bar — 8px rhythm, island strategy */}
      <div className="mb-6 flex h-20 w-full flex-shrink-0 items-center justify-between border-b border-white/10 bg-gradient-to-r from-slate-900 to-slate-950">
        <h2 className="text-2xl font-bold">Fleet Management</h2>
        <div className="flex flex-wrap items-center gap-6">
          {showFleetWrite && (
            <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 p-1.5 pr-2">
              <select
                value={targetCampaignId}
                onChange={(e) => setTargetCampaignId(e.target.value)}
                className="h-9 w-64 min-w-[14rem] rounded border border-white/5 bg-black/20 text-sm focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select Campaign to Assign...</option>
                <option value="__unassign__">Clear Campaign (Unassigned)</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                onClick={onAssign}
                disabled={!targetCampaignId || selectedTokenIds.size === 0}
                className="h-9 rounded bg-primary px-4 text-sm font-medium tracking-wide text-primary-foreground disabled:opacity-50"
              >
                Set Campaign
              </button>
            </div>
          )}
          {canAssignToSchool && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-white/5 p-1.5 pr-2">
              {isSuperAdmin && (
                <>
                  <select
                    value={targetSchoolId}
                    onChange={(e) => setTargetSchoolId(e.target.value)}
                    className="h-9 w-64 min-w-[14rem] rounded border border-white/5 bg-black/20 text-sm focus:ring-2 focus:ring-primary/20"
                    title="Assign selected tokens to an organization"
                  >
                    <option value="">Select organization...</option>
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  {organizations.length === 0 && (
                    <span className="text-xs text-amber-500" title="Add organizations in Supabase (see docs).">
                      No organizations — add in Supabase
                    </span>
                  )}
                </>
              )}
              <button
                onClick={onAssignToSchool}
                disabled={!targetSchoolId || selectedTokenIds.size === 0}
                className="h-9 rounded border border-amber-500/50 px-4 text-sm font-medium text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
              >
                Transfer Fleet
              </button>
            </div>
          )}
          <button
            onClick={onRefresh}
            className="h-9 rounded border border-white/10 px-4 text-sm hover:bg-white/5"
          >
            Refresh
          </button>
        </div>
      </div>

      {assignToSchoolMessage && (
        <div
          className={`mb-4 rounded border px-4 py-2 text-sm ${
            assignToSchoolMessage.type === "success"
              ? "border-success bg-success/10 text-success"
              : "border-destructive bg-destructive/10 text-destructive"
          }`}
        >
          {assignToSchoolMessage.text}
        </div>
      )}

      {/* Level 1 surface — table card */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-900/50">
        {tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <Box className="h-12 w-12 text-muted-foreground/60" strokeWidth={1.25} />
            <p className="text-sm text-muted-foreground">No assets assigned to this sector.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-4">
                  <input
                    type="checkbox"
                    checked={tokens.length > 0 && selectedTokenIds.size === tokens.length}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="rounded border-border"
                  />
                </th>
                {showOrgColumn && <th className="p-4">Organization</th>}
                <th className="p-4">Asset ID</th>
                <th className="p-4">Coordinates</th>
                <th className="p-4">Active Campaign</th>
                <th className="p-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {tokens.map((t) => (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={selectedTokenIds.has(t.id)}
                      onChange={() => toggleOne(t.id)}
                      disabled={isAuditor}
                      className="rounded border-border"
                    />
                  </td>
                  {showOrgColumn && (
                    <td className="p-4">
                      <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">
                        {t.organizations?.name ?? "—"}
                      </span>
                    </td>
                  )}
                  <td className="p-4 font-mono text-xs">...{t.id.slice(-8)}</td>
                  <td className="p-4 font-mono text-xs text-muted-foreground">
                    {t.lat.toFixed(4)}, {t.lng.toFixed(4)}
                  </td>
                  <td className="p-4 font-bold text-success">
                    {t.campaigns?.name ?? "Unassigned"}
                  </td>
                  <td className="p-4 text-right">
                    <span className="rounded bg-white/5 px-2 py-1 font-mono text-[10px] font-bold uppercase">
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CampaignsTab({
  campaigns,
  onRefresh,
  supabase,
  orgId,
  organizations,
  userRole,
  campaignsWrite,
  showArchivedCampaigns,
  setShowArchivedCampaigns,
}: {
  campaigns: Campaign[];
  onRefresh: () => void;
  supabase: ReturnType<typeof createClient>;
  orgId: string | null;
  organizations: Organization[];
  userRole: string | undefined;
  campaignsWrite: boolean;
  showArchivedCampaigns: boolean;
  setShowArchivedCampaigns: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [questions, setQuestions] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [createOrgId, setCreateOrgId] = useState<string>("");
  const [createError, setCreateError] = useState<string>("");

  const addQuestion = () => {
    if (questions.length >= MAX_QUESTIONS) return;
    setQuestions((q) => [...q, ""]);
  };
  const removeQuestion = (i: number) => {
    setQuestions((q) => q.filter((_, idx) => idx !== i));
  };
  const setQuestion = (i: number, text: string) => {
    setQuestions((q) => {
      const next = [...q];
      next[i] = text;
      return next;
    });
  };

  async function createCampaign() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const targetOrgId = orgId ?? (createOrgId || null);
    if (!targetOrgId) {
      setCreateError("Select an organization for this campaign.");
      return;
    }
    const { data: existing } = await supabase
      .from("campaigns")
      .select("id")
      .eq("organization_id", targetOrgId)
      .eq("name", trimmedName)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      setCreateError("A campaign with this name already exists for this organization.");
      return;
    }
    setCreateError("");
    const qs: CampaignQuestion[] = questions
      .map((text, order) => ({ order: order + 1, text: text.trim() }))
      .filter((q) => q.text.length > 0);
    setSaving(true);
    const { error } = await supabase.from("campaigns").insert({
      name: trimmedName,
      required_fields: CAMPAIGN_REQUIRED_FIELDS,
      questions: qs.length ? qs : null,
      organization_id: targetOrgId,
    });
    setSaving(false);
    if (!error) {
      setName("");
      setQuestions([""]);
      setCreateOrgId("");
      onRefresh();
    } else {
      setCreateError(error.message);
    }
  }

  const questionCount = (c: Campaign) =>
    Array.isArray(c.questions) ? c.questions.length : 0;
  const requiredCount = CAMPAIGN_REQUIRED_FIELDS.length;

  return (
    <div className="mx-auto grid max-w-[98vw] grid-cols-1 gap-8 px-4 py-8 font-sans lg:grid-cols-2">
      {campaignsWrite && (
      <div className="flex flex-col p-4">
        <h2 className="mb-6 text-xl font-bold">Create Campaign</h2>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left column — Logistics */}
          <fieldset className="space-y-6 lg:col-span-5">
            <legend className="px-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Logistics
            </legend>
            {userRole === "SUPER_ADMIN" && orgId === null && (
              <div className="space-y-2">
                <label className="block text-sm text-muted-foreground">Organization</label>
                <select
                  value={createOrgId}
                  onChange={(e) => { setCreateOrgId(e.target.value); setCreateError(""); }}
                  className="h-10 w-full rounded border border-border bg-black/20 px-3 text-sm focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select organization...</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                {organizations.length === 0 && (
                  <p className="text-xs text-amber-500">
                    No organizations found. Add the <code className="rounded bg-muted px-1">organizations</code> table in Supabase (id, name, slug), add RLS so you can read it, and insert at least one row. See <code className="rounded bg-muted px-1">docs/ORGANIZATIONS_SETUP.md</code>.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <label className="block text-sm text-muted-foreground">Campaign name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Austin Q1 Survey"
                className="h-10 w-full rounded border border-border bg-black/20 px-3 text-sm focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="rounded-r-md border-l-2 border-emerald-500 bg-emerald-950/30 p-4 font-mono text-xs text-emerald-400">
              <h3 className="mb-2 font-semibold uppercase tracking-wider">
                Required fields (reward payout)
              </h3>
              <ul className="space-y-1.5">
                {CAMPAIGN_REQUIRED_FIELDS.map((f) => (
                  <li key={f.key} className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    {f.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">
                Collected for every response; used for payouts.
              </p>
            </div>
          </fieldset>
          {/* Right column — Additional questions */}
          <div className="space-y-4 lg:col-span-7">
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">
                Additional questions (up to {MAX_QUESTIONS})
              </label>
              {questions.length < MAX_QUESTIONS && (
                <button
                  type="button"
                  onClick={addQuestion}
                  className="text-xs text-primary hover:underline"
                >
                  + Add
                </button>
              )}
            </div>
            <div className="space-y-4">
              {questions.map((q, i) => (
                <div
                  key={i}
                  className="group relative flex gap-2 rounded-md transition-colors hover:bg-white/5"
                >
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQuestion(i, e.target.value)}
                    placeholder={`Question ${i + 1}`}
                    className="h-10 flex-1 rounded border border-border bg-black/20 px-3 text-sm focus:ring-2 focus:ring-primary/20"
                  />
                  {questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuestion(i)}
                      className="text-destructive hover:underline"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        {createError && <p className="mt-4 text-sm text-destructive">{createError}</p>}
        <div className="mt-8 flex justify-end border-t border-white/10 pt-8">
          <button
            onClick={createCampaign}
            disabled={saving || !name.trim() || (orgId === null && !createOrgId)}
            className="h-11 w-full rounded bg-primary px-6 text-base font-semibold text-primary-foreground shadow-lg shadow-blue-500/20 disabled:opacity-50 md:w-auto md:min-w-[200px]"
          >
            {saving ? "Launching…" : "Launch Campaign"}
          </button>
        </div>
      </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">{showArchivedCampaigns ? "All Surveys" : "Active Surveys"}</h2>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchivedCampaigns}
              onChange={(e) => setShowArchivedCampaigns(e.target.checked)}
              className="rounded border-accent"
            />
            Show archived
          </label>
        </div>
        {campaigns.length === 0 && (
          <p className="text-sm italic text-muted-foreground">No campaigns yet.</p>
        )}
        {campaigns.map((c) => (
          <Link
            key={c.id}
            href={`/campaigns/${c.id}`}
            className="flex justify-between rounded-lg border border-white/10 bg-slate-900/50 p-4 transition hover:bg-white/5"
          >
            <div>
              <span className="font-bold">{c.name}</span>
              {organizations.length > 0 && (
                <span className="ml-2 rounded bg-muted-foreground/20 px-1.5 py-0.5 text-xs text-muted-foreground">
                  {organizations.find((o) => o.id === c.organization_id)?.name ?? "—"}
                </span>
              )}
              {(c as Campaign & { deleted_at?: string | null }).deleted_at && (
                <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">Archived</span>
              )}
              <p className="font-mono text-xs text-muted-foreground">{c.id}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {requiredCount} required fields
                {questionCount(c) > 0 && ` + ${questionCount(c)} questions`}
              </p>
            </div>
            <div className="text-right text-sm font-bold text-primary">
              {questionCount(c)} custom →
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

const PERMISSION_LABELS: Record<string, string> = {
  fleet_write: "Fleet write (bulk assign campaign)",
  campaigns_write: "Campaigns write (create / edit)",
  map_reset: "Map reset (reset simulation)",
};

function SettingsTab({
  rolePermissions,
  onRefresh,
}: {
  rolePermissions: RolePermissionRow[];
  onRefresh: () => void;
}) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const getEnabled = (role: string, key: string) =>
    rolePermissions.some((r) => r.role === role && r.permission_key === key && r.enabled);

  const handleToggle = async (role: string, permissionKey: string, enabled: boolean) => {
    const id = `${role}:${permissionKey}`;
    setUpdating(id);
    setSavedId(null);
    const result = await setRolePermission(role, permissionKey, enabled);
    setUpdating(null);
    if (result.success) {
      onRefresh();
      setSavedId(id);
      setTimeout(() => setSavedId(null), 2000);
    }
  };

  return (
    <div className="mx-auto max-w-[98vw] px-4 py-8">
      <h2 className="mb-2 text-2xl font-bold">Role permissions</h2>
      <p className="mb-8 text-sm text-muted-foreground">
        Turn on or off write access for each profile. All org profiles can see fleet, campaigns, and map data; these toggles control who can change things. SUPER_ADMIN always has full access.
      </p>
      <div className="space-y-8">
        {CONTROLLABLE_ROLES.map((role) => (
          <div key={role} className="rounded-xl border border-accent bg-muted p-6">
            <h3 className="mb-4 font-mono text-sm font-bold uppercase text-primary">{role}</h3>
            <div className="flex flex-wrap gap-6">
              {ROLE_PERMISSION_KEYS.map((key) => {
                const id = `${role}:${key}`;
                const enabled = getEnabled(role, key);
                return (
                  <label key={id} className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={updating === id}
                      onChange={(e) => handleToggle(role, key, e.target.checked)}
                      className="h-4 w-4 rounded border-accent"
                    />
                    <span className="text-sm">{PERMISSION_LABELS[key] ?? key}</span>
                    {updating === id && <span className="text-xs text-muted-foreground">Saving…</span>}
                    {savedId === id && updating !== id && (
                      <span className="text-xs font-medium text-success">Saved</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Calculate Total Deal Value (TDV) using the OYE formula.
 * Formula: TDV = (S * (R_pm * 9) * 25) / (0.567 * r_deal)
 * 
 * @param targetStudents - S: Target number of student participants
 * @param redemptionVelocity - R_pm: Target tokens per student/month (e.g., 0.5)
 * @param assumedYieldRate - r_deal: Assumed yield rate as percentage (e.g., 3.0 for 3.0%)
 * @returns TDV in dollars
 */
function calculateTDV(
  targetStudents: number,
  redemptionVelocity: number,
  assumedYieldRate: number
): number {
  const K_EFF = 0.567; // Efficiency constant
  const TIME_MULTIPLIER = 9; // Academic year (Sept-May)
  const TOKEN_VALUE = 25; // $25 per token
  
  // Convert yield rate from percentage to decimal (3.0% -> 0.03)
  const rDealDecimal = assumedYieldRate / 100;
  
  const numerator = targetStudents * (redemptionVelocity * TIME_MULTIPLIER) * TOKEN_VALUE;
  const denominator = K_EFF * rDealDecimal;
  
  return numerator / denominator;
}

/**
 * Calculate annual distributions from TDV and yield rate.
 */
function calculateDistributions(tdv: number, yieldRatePercent: number) {
  const yieldRateDecimal = yieldRatePercent / 100;
  const annualYield = tdv * yieldRateDecimal;
  
  return {
    studentWelfare: annualYield * 0.63, // 63% to students
    operatorRevenue: annualYield * 0.12, // 12% to operator
    principalProtection: annualYield * 0.25, // 25% to principal
  };
}

/**
 * Calculate value-led KPIs for deal closing.
 */
function calculateValueKPIs(tdv: number, yieldRatePercent: number) {
  const yieldRateDecimal = yieldRatePercent / 100;
  
  // Mission Output (Annual) = TDV * Yield * 0.63
  const missionOutput = tdv * yieldRateDecimal * 0.63;
  
  // Value Return Horizon = 1 / (Yield * 0.63) in years
  const paybackYears = 1 / (yieldRateDecimal * 0.63);
  
  // Principal Growth Projection (10-Year) = TDV * (1 + (Yield * 0.25))^10
  const principalGrowthRate = yieldRateDecimal * 0.25;
  const tenYearFV = tdv * Math.pow(1 + principalGrowthRate, 10);
  
  // Monthly tokens generated = Annual Mission Output / 9 months / $25 per token
  const monthlyTokens = missionOutput / 9 / 25;
  
  return {
    missionOutput,
    paybackYears,
    tenYearFV,
    monthlyTokens,
  };
}

function PricingTab({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [name, setName] = useState("");
  const [targetStudents, setTargetStudents] = useState(1000);
  const [redemptionVelocity, setRedemptionVelocity] = useState(0.5);
  const [assumedYieldRate, setAssumedYieldRate] = useState(3.0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [scenarios, setScenarios] = useState<DealScenario[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState(false);

  // Calculate TDV and value-led KPIs in real-time
  const tdv = calculateTDV(targetStudents, redemptionVelocity, assumedYieldRate);
  const distributions = calculateDistributions(tdv, assumedYieldRate);
  const valueKPIs = calculateValueKPIs(tdv, assumedYieldRate);

  // Load saved scenarios
  useEffect(() => {
    setLoadingScenarios(true);
    supabase
      .from("deal_scenarios")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("[Pricing] Error loading scenarios:", error);
        } else {
          setScenarios((data as DealScenario[]) ?? []);
        }
        setLoadingScenarios(false);
      });
  }, [supabase]);

  async function handleSave() {
    if (!name.trim()) {
      setSaveError("Please enter a deal name.");
      return;
    }
    setSaveError("");
    setSaving(true);

    const { error } = await supabase.from("deal_scenarios").insert({
      name: name.trim(),
      target_students: targetStudents,
      redemption_velocity: redemptionVelocity,
      assumed_yield_rate: assumedYieldRate,
      tdv_amount: tdv,
      annual_student_welfare: distributions.studentWelfare,
      annual_operator_revenue: distributions.operatorRevenue,
      annual_principal_protection: distributions.principalProtection,
    });

    setSaving(false);
    if (error) {
      setSaveError(error.message);
    } else {
      setName("");
      setTargetStudents(1000);
      setRedemptionVelocity(0.5);
      setAssumedYieldRate(3.0);
      // Reload scenarios
      const { data } = await supabase
        .from("deal_scenarios")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) setScenarios((data as DealScenario[]) ?? []);
    }
  }

  function loadScenario(scenario: DealScenario) {
    setName(scenario.name);
    setTargetStudents(scenario.target_students);
    setRedemptionVelocity(scenario.redemption_velocity);
    setAssumedYieldRate(scenario.assumed_yield_rate);
  }

  return (
    <div className="mx-auto max-w-[98vw] px-4 py-8 font-sans">
      <h2 className="mb-6 text-2xl font-bold">Deal Sizing Calculator</h2>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left Column: Input Form */}
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-6 backdrop-blur-sm">
            <h3 className="mb-4 text-lg font-semibold">Deal Parameters</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">
                  Institution / Opportunity Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaveError("");
                  }}
                  placeholder="e.g., State University Pilot"
                  className="h-10 w-full rounded border border-border bg-black/20 px-3 text-sm focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
                  Campus Impact Scale (S)
                  <span
                    className="cursor-help text-xs text-slate-500"
                    title="Number of students eligible for the pilot"
                  >
                    ⓘ
                  </span>
                </label>
                <input
                  type="number"
                  value={targetStudents}
                  onChange={(e) => setTargetStudents(Number(e.target.value) || 0)}
                  min="1"
                  step="1"
                  className="h-10 w-full rounded border border-border bg-black/20 px-3 text-sm font-mono focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
                  Utilization Intensity (R<sub>pm</sub>)
                  <span
                    className="cursor-help text-xs text-slate-500"
                    title="Projected tokens redeemed per student per month"
                  >
                    ⓘ
                  </span>
                </label>
                <input
                  type="number"
                  value={redemptionVelocity}
                  onChange={(e) => setRedemptionVelocity(Number(e.target.value) || 0)}
                  min="0"
                  step="0.1"
                  className="h-10 w-full rounded border border-border bg-black/20 px-3 text-sm font-mono focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
                  Market Yield Environment (r<sub>deal</sub>)
                  <span
                    className="cursor-help text-xs text-slate-500"
                    title="Benchmark interest rate, e.g., 3.0% for Standard"
                  >
                    ⓘ
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={assumedYieldRate}
                    onChange={(e) => setAssumedYieldRate(Number(e.target.value) || 0)}
                    min="0"
                    max="100"
                    step="0.1"
                    className="h-10 flex-1 rounded border border-border bg-black/20 px-3 text-sm font-mono focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>
          </div>

          {saveError && (
            <div className="rounded-lg border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-400">
              {saveError}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="h-11 w-full rounded bg-primary px-6 text-base font-semibold text-primary-foreground shadow-lg shadow-blue-500/20 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Scenario"}
          </button>
        </div>

        {/* Right Column: Killer Metrics */}
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-6 backdrop-blur-sm">
            <h3 className="mb-4 text-lg font-semibold">Key Performance Indicators</h3>
            <div className="space-y-4">
              {/* Endowment Capital */}
              <div className="rounded-lg border border-blue-500/20 bg-blue-950/30 p-4">
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-blue-400">
                  Endowment Capital Required
                </div>
                <div className="font-mono text-2xl font-bold text-blue-400">
                  ${tdv.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
              </div>

              {/* Mission Output */}
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/30 p-4">
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-emerald-400">
                  Mission Output (Annual)
                </div>
                <div className="font-mono text-xl font-bold text-emerald-400">
                  ${valueKPIs.missionOutput.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
                <div className="mt-1 text-xs text-slate-500">Annual student value delivered</div>
              </div>

              {/* Value Return Horizon */}
              <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Value Return Horizon
                  </span>
                  {valueKPIs.paybackYears < 25 && (
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      High Efficiency
                    </span>
                  )}
                </div>
                <div className="font-mono text-xl font-bold text-white">
                  {valueKPIs.paybackYears.toFixed(1)} Years
                </div>
                <div className="mt-1 text-xs text-slate-500">Years to 100% Value Recoup</div>
              </div>

              {/* Principal Growth Projection */}
              <div className="rounded-lg border border-amber-500/20 bg-amber-950/30 p-4">
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-amber-400">
                  Principal Growth Projection (10-Year)
                </div>
                <div className="font-mono text-xl font-bold text-amber-400">
                  ${valueKPIs.tenYearFV.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
                <div className="mt-1 text-xs text-slate-500">Projected principal value after 10 years</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Closing Statement */}
      <div className="mt-12 rounded-xl border border-emerald-500/20 bg-emerald-950/30 p-6 backdrop-blur-sm">
        <h3 className="mb-4 text-lg font-semibold text-emerald-400">Executive Summary</h3>
        <div className="space-y-3 text-sm leading-relaxed text-slate-300">
          <p>
            To sustain a{" "}
            <span className="font-mono font-semibold text-emerald-400">
              {redemptionVelocity.toFixed(1)} tokens/month
            </span>{" "}
            pilot for{" "}
            <span className="font-mono font-semibold text-emerald-400">
              {targetStudents.toLocaleString()} students
            </span>
            , {name.trim() || "the institution"} requires an endowment of{" "}
            <span className="font-mono font-semibold text-blue-400">
              ${tdv.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
            .
          </p>
          <p>
            At a{" "}
            <span className="font-mono font-semibold text-emerald-400">
              {assumedYieldRate.toFixed(1)}%
            </span>{" "}
            market rate, this capital engine will generate approximately{" "}
            <span className="font-mono font-semibold text-emerald-400">
              {valueKPIs.monthlyTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>{" "}
            tokens ($25/ea) every month during the academic year.
          </p>
          <div className="mt-4 border-t border-emerald-500/20 pt-4">
            <p className="font-semibold text-emerald-400">The Bottom Line:</p>
            <p className="mt-2">
              This structure delivers{" "}
              <span className="font-mono font-semibold text-emerald-400">
                ${valueKPIs.missionOutput.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>{" "}
              in annual student value. In{" "}
              <span className="font-mono font-semibold text-emerald-400">
                {valueKPIs.paybackYears.toFixed(1)}
              </span>{" "}
              years, the system will have distributed 100% of the initial capital value back to
              students, while the principal base is projected to grow to{" "}
              <span className="font-mono font-semibold text-emerald-400">
                ${valueKPIs.tenYearFV.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>{" "}
              via the 25% protection mechanism.
            </p>
          </div>
        </div>
      </div>

      {/* Saved Scenarios List */}
      <div className="mt-12">
        <h3 className="mb-4 text-lg font-semibold">Saved Scenarios</h3>
        {loadingScenarios ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : scenarios.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-slate-900/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">No saved scenarios yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {scenarios.map((scenario) => (
              <div
                key={scenario.id}
                className="group cursor-pointer rounded-lg border border-white/10 bg-slate-900/50 p-4 transition hover:bg-white/5"
                onClick={() => loadScenario(scenario)}
              >
                <div className="mb-2 font-semibold">{scenario.name}</div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="font-mono">
                    TDV: ${scenario.tdv_amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                  <div>
                    {scenario.target_students.toLocaleString()} students @ {scenario.redemption_velocity} tokens/mo
                  </div>
                  <div>Yield: {scenario.assumed_yield_rate}%</div>
                  {scenario.created_at && (
                    <div className="mt-2 text-slate-600">
                      {new Date(scenario.created_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
