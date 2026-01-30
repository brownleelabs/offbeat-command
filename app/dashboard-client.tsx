"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Box, Info, ArrowUp, ArrowDown } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useDashboard, type ViewMode } from "@/components/dashboard-context";
import { DealDeskContent } from "@/app/deal-desk/page";
import { insertDealScenario, listDealScenarios } from "@/app/deal-desk/scenario-actions";

const MapView = dynamic(() => import("@/components/map-view"), { ssr: false });
import {
  ROLE_PERMISSION_KEYS,
  CONTROLLABLE_ROLES,
  ALL_ROLES,
  type RolePermissionRow,
} from "@/lib/constants";
import {
  bulkAssignTokensToSchool,
  createOrganization,
  createUserByEmail,
  deleteOrganization,
  getRedemptionSuccessMessage,
  getRolePermissions,
  listUsers,
  resetUserPassword,
  setRedemptionSuccessMessage,
  setRolePermission,
  updateUserRole,
  type ListUserRow,
} from "@/app/actions";
import {
  listTokens,
  assignTokensToCampaign,
  exportClaimUrls,
  getFleetAuditLog,
  getMapAnalytics,
  getToken,
  createTokens,
  reloadTokens,
  deleteToken,
  loadFundsToToken,
  loadFundsToTokens,
  removeFundsFromToken,
  getTokenCountsByCampaignIds,
  type ListTokensResult,
  type FleetOrderBy,
  type FleetOrderDir,
} from "@/app/fleet/fleet-actions";
import {
  archiveCampaigns,
  insertCampaign,
  listCampaigns,
  softDeleteCampaigns,
  updateCampaignPinned,
  type ListCampaignsResult,
} from "@/app/campaigns/campaign-actions";
import type { Campaign, TokenWithCampaign, DealScenario } from "@/types";
import type { CampaignQuestion } from "@/types";
import { CAMPAIGN_REQUIRED_FIELDS } from "@/types";

/** Campus/tenant entity. In the DB: table `organizations`. Public-facing UI uses "school" (e.g. /schools); Command Center uses "organization". */
type Organization = { id: string; name: string };

/** Organization with slug and type for Settings tab (list + add). */
type OrganizationWithType = { id: string; name: string; slug: string | null; type: string };

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

/** Normalize raw token rows so Fleet tab always has TokenWithCampaign shape (lat/lng, campaigns, organizations, balance). */
function normalizeTokensWithCampaign(rows: unknown[]): TokenWithCampaign[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const lat = (r.lat as number) ?? (r.latitude as number) ?? 0;
    const lng = (r.lng as number) ?? (r.longitude as number) ?? 0;
    const org = (r.organizations ?? r.organization) as { name: string } | null | undefined;
    const balance = r.balance != null ? Number(r.balance) : undefined;
    const created_at = typeof r.created_at === "string" ? r.created_at : null;
    return {
      id: String(r.id),
      lat: Number(lat),
      lng: Number(lng),
      status: (r.status === "found" ? "found" : "active") as "active" | "found",
      organization_id: (r.organization_id as string) ?? null,
      campaign_id: (r.campaign_id as string) ?? null,
      campaigns: (r.campaigns as { name: string } | null) ?? null,
      organizations: org ?? null,
      ...(typeof balance === "number" && !Number.isNaN(balance) ? { balance } : {}),
      ...(created_at ? { created_at } : {}),
    };
  });
}

const ADMIN_ROLES = ["SUPER_ADMIN", "ORG_ADMIN", "AUDITOR"] as const;
function isAdminRole(role: string | undefined): role is (typeof ADMIN_ROLES)[number] {
  return role != null && (ADMIN_ROLES as readonly string[]).includes(role);
}

export default function AdminDashboard() {
  const { viewMode, toggleViewMode, setViewMode, setSelectedOrgId, userRole, orgId, dataScopeOrgId, loading, profile, authError } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("map");

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "map" || tab === "fleet" || tab === "campaigns" || tab === "settings" || tab === "pricing") setActiveTab(tab);
  }, [searchParams]);

  const switchTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    const base = pathname ?? "/";
    router.replace(`${base}?tab=${tab}`, { scroll: false });
  }, [pathname, router]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tokens, setTokens] = useState<TokenWithCampaign[]>([]);
  const [fleetScopeTotal, setFleetScopeTotal] = useState<number | null>(null);
  const [fleetScopeFound, setFleetScopeFound] = useState<number | null>(null);
  const [responsesCount, setResponsesCount] = useState<number>(0);
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(new Set());
  const [targetCampaignId, setTargetCampaignId] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationsForSettings, setOrganizationsForSettings] = useState<OrganizationWithType[]>([]);
  const [targetSchoolId, setTargetSchoolId] = useState("");
  const [assignToSchoolMessage, setAssignToSchoolMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [assignCampaignMessage, setAssignCampaignMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [rolePermissions, setRolePermissions] = useState<RolePermissionRow[]>([]);
  const [showArchivedCampaigns, setShowArchivedCampaigns] = useState(false);
  // Fleet tab: server-side list (listTokens)
  const [fleetRows, setFleetRows] = useState<unknown[]>([]);
  const [fleetTotal, setFleetTotal] = useState(0);
  const [fleetPage, setFleetPage] = useState(1);
  const [fleetPageSize, setFleetPageSize] = useState(25);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState("");
  const [fleetCampaignIdFilter, setFleetCampaignIdFilter] = useState<string>("");
  const [fleetStatusFilter, setFleetStatusFilter] = useState<"all" | "active" | "found">("all");
  const [fleetSearchQuery, setFleetSearchQuery] = useState<string>("");
  const [fleetOrderBy, setFleetOrderBy] = useState<FleetOrderBy>("id");
  const [fleetOrderDir, setFleetOrderDir] = useState<FleetOrderDir>("asc");
  const [assignCampaignLoading, setAssignCampaignLoading] = useState(false);
  const [reloadingTokenId, setReloadingTokenId] = useState<string | null>(null);
  const [exportFleetLoading, setExportFleetLoading] = useState(false);
  const [bulkLoadAmount, setBulkLoadAmount] = useState("25");
  const [bulkLoadSubmitting, setBulkLoadSubmitting] = useState(false);
  const [bulkLoadMessage, setBulkLoadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [exportFleetMessage, setExportFleetMessage] = useState<{ type: "success"; text: string } | null>(null);
  const [fleetAuditEvents, setFleetAuditEvents] = useState<{ event_type: string; at: string; actor_user_id: string | null; payload?: Record<string, unknown> | null }[]>([]);
  const [fleetAuditOpen, setFleetAuditOpen] = useState(false);
  const [fleetTokenCountByCampaignId, setFleetTokenCountByCampaignId] = useState<Record<string, number>>({});
  const [fleetDetailTokenId, setFleetDetailTokenId] = useState<string | null>(null);
  const [mapCampaignId, setMapCampaignId] = useState<string | null>(null);
  const [fleetDetailToken, setFleetDetailToken] = useState<{
    id: string; lat: number; lng: number; status: "active" | "found";
    organization_id: string | null; campaign_id: string | null; balance?: number;
    created_at?: string | null; redeemed_at?: string | null; reloaded_at?: string | null;
    campaigns?: { name: string } | null; organizations?: { name: string } | null;
    claim_url?: string; claim_url_restricted?: boolean;
    redeemer?: { first_name: string; last_name: string; student_email: string; student_id: string } | null;
    first_redeemer?: { first_name: string; last_name: string; student_email: string; student_id: string } | null;
  } | null>(null);
  const [fleetDetailLoading, setFleetDetailLoading] = useState(false);
  const [fleetDetailError, setFleetDetailError] = useState<string | null>(null);
  const [fleetDetailFundAmount, setFleetDetailFundAmount] = useState("25");
  const [fleetDetailFunding, setFleetDetailFunding] = useState(false);
  const [fleetDetailDeleteConfirm, setFleetDetailDeleteConfirm] = useState(false);
  const [fleetDetailDeleting, setFleetDetailDeleting] = useState(false);
  const fleetDetailModalRef = useRef<HTMLDivElement>(null);

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

  // Fetch all organization types for Settings (school + institution) so "Offbeat Options" and other orgs appear for user/role assignment.
  const refreshOrganizationsForSettings = useCallback(() => {
    const client = createClient();
    client
      .from("organizations")
      .select("id, name, slug, type")
      .in("type", ["school", "institution"])
      .order("name")
      .then(({ data }) => setOrganizationsForSettings((data as OrganizationWithType[]) ?? []));
  }, []);
  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") return;
    refreshOrganizationsForSettings();
  }, [userRole, refreshOrganizationsForSettings]);

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
      try {
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
      } catch {
        if (!cancelled) setOrgName(null);
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
      .order("created_at", { ascending: false })
      .limit(500);
    // Fleet dropdown/list should never include deleted campaigns; optionally hide archived too.
    campaignsQuery = campaignsQuery.is("deleted_at", null);
    if (!showArchivedCampaigns) {
      campaignsQuery = campaignsQuery.is("archived_at", null);
    }
    if (filterOrgId != null) {
      campaignsQuery = campaignsQuery.eq("organization_id", filterOrgId);
    }
    try {
      const { data: cData } = await campaignsQuery;
      setCampaigns((cData as Campaign[]) ?? []);
    } catch {
      setCampaigns([]);
    }

    // Bounded stats from server (Phase 4: no unbounded token fetch)
    try {
      const analyticsRes = await getMapAnalytics(filterOrgId ?? undefined);
      if (analyticsRes.success) {
        setFleetScopeTotal(analyticsRes.total);
        setFleetScopeFound(analyticsRes.found);
      } else {
        setFleetScopeTotal(0);
        setFleetScopeFound(0);
      }
      setTokens([]);
    } catch {
      setFleetScopeTotal(0);
      setFleetScopeFound(0);
      setTokens([]);
    }

    let responsesQuery = supabase
      .from("responses")
      .select("*", { count: "exact", head: true });
    if (filterOrgId != null) {
      responsesQuery = responsesQuery.eq("organization_id", filterOrgId);
    }
    try {
      const { count } = await responsesQuery;
      setResponsesCount(count ?? 0);
    } catch {
      setResponsesCount(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase from createClient() at top of component, omit to avoid refetch loop
  }, [dataScopeOrgId, showArchivedCampaigns]);

  const loadFleetList = useCallback(
    async (overridePage?: number) => {
      if (!isAdminRole(userRole)) return;
      const pageToLoad = overridePage ?? fleetPage;
      const page = Math.max(1, Math.floor(Number(pageToLoad) || 1));
      setFleetLoading(true);
      setFleetError("");
      try {
        const res: ListTokensResult<unknown> = await listTokens({
          page,
          pageSize: fleetPageSize,
          organizationId: dataScopeOrgId ?? undefined,
          campaignId: fleetCampaignIdFilter && fleetCampaignIdFilter.trim() ? fleetCampaignIdFilter.trim() : undefined,
          status: fleetStatusFilter === "all" ? undefined : fleetStatusFilter,
          searchQuery: fleetSearchQuery?.trim() || undefined,
        });
        if (!res.success) {
          setFleetError(res.error ?? "Failed to load fleet.");
          setFleetRows([]);
          setFleetTotal(0);
          return;
        }
        setFleetRows(Array.isArray(res.rows) ? res.rows : []);
        const total = typeof res.total === "number" && res.total >= 0 ? Math.floor(res.total) : 0;
        setFleetTotal(total);
        const maxPage = fleetPageSize > 0 ? Math.max(1, Math.ceil(total / fleetPageSize)) : 1;
        if (page > maxPage) setFleetPage(maxPage);
      } catch {
        setFleetError("Failed to load fleet.");
        setFleetRows([]);
        setFleetTotal(0);
      } finally {
        setFleetLoading(false);
      }
    },
    // fleetOrderBy/fleetOrderDir kept for cache identity when user changes sort
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      userRole,
      fleetPage,
      fleetPageSize,
      dataScopeOrgId,
      fleetCampaignIdFilter,
      fleetStatusFilter,
      fleetSearchQuery,
      fleetOrderBy,
      fleetOrderDir,
    ]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (activeTab === "fleet" && isAdminRole(userRole)) {
      loadFleetList(fleetPage);
    }
  }, [activeTab, userRole, fleetPage, fleetPageSize, fleetCampaignIdFilter, fleetStatusFilter, fleetOrderBy, fleetOrderDir, loadFleetList]);

  const fleetCampaignIdsKey = campaigns
    .filter((c) => !c.deleted_at)
    .map((c) => c.id)
    .filter((id): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    .sort()
    .join(",");
  useEffect(() => {
    if (activeTab !== "fleet" || !isAdminRole(userRole) || !fleetCampaignIdsKey) {
      if (activeTab !== "fleet") setFleetTokenCountByCampaignId({});
      return;
    }
    const ids = fleetCampaignIdsKey ? fleetCampaignIdsKey.split(",") : [];
    if (ids.length === 0) {
      setFleetTokenCountByCampaignId({});
      return;
    }
    let cancelled = false;
    getTokenCountsByCampaignIds(ids, dataScopeOrgId ?? undefined).then((res) => {
      if (!cancelled && res.success) setFleetTokenCountByCampaignId(res.counts);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, userRole, dataScopeOrgId, fleetCampaignIdsKey]);

  // ORG_ADMIN: keep targetSchoolId in sync with their org so "Assign to my organization" works
  useEffect(() => {
    if (userRole === "ORG_ADMIN" && profile?.organization_id) {
      setTargetSchoolId(profile.organization_id);
    }
  }, [userRole, profile?.organization_id]);

  // Fleet asset detail modal: load token when fleetDetailTokenId is set (from Fleet tab row click or Map tab pin click)
  useEffect(() => {
    if (!fleetDetailTokenId) {
      setFleetDetailToken(null);
      setFleetDetailError(null);
      return;
    }
    let cancelled = false;
    setFleetDetailLoading(true);
    setFleetDetailError(null);
    getToken(fleetDetailTokenId).then((res) => {
      if (cancelled) return;
      setFleetDetailLoading(false);
      if (res.success && res.token) {
        setFleetDetailToken(res.token);
        setFleetDetailError(null);
      } else {
        setFleetDetailToken(null);
        setFleetDetailError(res.success ? "Failed to load asset." : (res.error ?? "Failed to load asset."));
      }
    }).catch(() => {
      if (!cancelled) {
        setFleetDetailLoading(false);
        setFleetDetailToken(null);
        setFleetDetailError("Failed to load asset.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fleetDetailTokenId]);

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
                // Fetch new campaign data asynchronously only when campaign_id is a valid UUID (avoid malformed DB data reaching Supabase)
                const rawCid = token.campaign_id;
                const validCampaignId =
                  typeof rawCid === "string" &&
                  rawCid.trim().length > 0 &&
                  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCid.trim())
                    ? rawCid.trim()
                    : null;
                if (validCampaignId) {
                  (async () => {
                    try {
                      const { data } = await supabase
                        .from("campaigns")
                        .select("name")
                        .eq("id", validCampaignId)
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
  const campaignIdUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function assignTokens() {
    if (selectedTokenIds.size === 0) return;
    if (targetCampaignId !== UNASSIGN_CAMPAIGN_VALUE && !targetCampaignId) return;
    if (
      targetCampaignId !== UNASSIGN_CAMPAIGN_VALUE &&
      (typeof targetCampaignId !== "string" ||
        targetCampaignId.trim().length === 0 ||
        !campaignIdUuidRegex.test(targetCampaignId.trim()))
    ) {
      setAssignCampaignMessage({ type: "error", text: "Invalid campaign." });
      return;
    }
    setAssignCampaignMessage(null);
    const validTokenIds = Array.from(selectedTokenIds).filter(
      (tid) => typeof tid === "string" && tid.trim().length > 0 && campaignIdUuidRegex.test(tid.trim())
    );
    if (validTokenIds.length === 0) {
      setAssignCampaignMessage({ type: "error", text: "No valid tokens selected." });
      return;
    }
    const campaignId = targetCampaignId === UNASSIGN_CAMPAIGN_VALUE ? null : targetCampaignId.trim();
    setAssignCampaignLoading(true);
    try {
      const result = await assignTokensToCampaign(validTokenIds, campaignId);
      if (result.success) {
        setAssignCampaignMessage(null);
        setAssignToSchoolMessage(null);
        setSelectedTokenIds(new Set());
        setTargetCampaignId("");
        loadData();
        loadFleetList(fleetPage);
        setAssignCampaignMessage({ type: "success", text: `${result.count} token(s) campaign updated.` });
        setTimeout(() => setAssignCampaignMessage(null), 3000);
      } else {
        setAssignCampaignMessage({ type: "error", text: result.error ?? "Failed to set campaign." });
      }
    } finally {
      setAssignCampaignLoading(false);
    }
  }

  async function assignTokensToSchool() {
    if (!targetSchoolId.trim() || selectedTokenIds.size === 0) return;
    setAssignToSchoolMessage(null);
    const result = await bulkAssignTokensToSchool(Array.from(selectedTokenIds), targetSchoolId);
    if (result.success) {
      setAssignToSchoolMessage({ type: "success", text: `${result.count} token(s) assigned to organization.` });
      setAssignCampaignMessage(null);
      setSelectedTokenIds(new Set());
      loadData();
      loadFleetList(fleetPage);
    } else {
      setAssignToSchoolMessage({ type: "error", text: result.error ?? "Failed to assign." });
    }
  }

  async function handleReloadToken(tokenId: string) {
    setReloadingTokenId(tokenId);
    setFleetError("");
    try {
      const result = await reloadTokens([tokenId]);
      if (result.success) {
        loadFleetList(fleetPage);
      } else {
        setFleetError(result.error ?? "Reload failed.");
      }
    } finally {
      setReloadingTokenId(null);
    }
  }

  async function handleDeleteToken(tokenId: string): Promise<boolean> {
    setFleetError("");
    try {
      const result = await deleteToken(tokenId);
      if (result.success) {
        loadFleetList(fleetPage);
        return true;
      }
      setFleetError(result.error ?? "Delete failed.");
      return false;
    } catch {
      setFleetError("Delete failed.");
      return false;
    }
  }

  async function handleFundToken(tokenId: string, amount: number): Promise<boolean> {
    setFleetError("");
    try {
      const result = await loadFundsToToken(tokenId, amount);
      if (result.success) {
        loadFleetList(fleetPage);
        return true;
      }
      setFleetError(result.error ?? "Load funds failed.");
      return false;
    } catch {
      setFleetError("Load funds failed.");
      return false;
    }
  }

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {}, () => {});
  }, []);

  async function handleBulkLoadFunds(amount: number): Promise<boolean> {
    if (selectedTokenIds.size === 0) return false;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 1 || amt > 25) {
      setBulkLoadMessage({ type: "error", text: "Enter an amount from $1 to $25 per token." });
      return false;
    }
    setBulkLoadSubmitting(true);
    setBulkLoadMessage(null);
    setFleetError("");
    try {
      const result = await loadFundsToTokens(Array.from(selectedTokenIds), amt);
      setBulkLoadSubmitting(false);
      if (result.success) {
        setBulkLoadMessage({
          type: "success",
          text: `Loaded $${result.amount} to ${result.count} asset(s).`,
        });
        loadFleetList(fleetPage);
        return true;
      }
      setBulkLoadMessage({ type: "error", text: result.error ?? "Bulk load failed." });
      return false;
    } catch {
      setBulkLoadSubmitting(false);
      setBulkLoadMessage({ type: "error", text: "Bulk load failed." });
      return false;
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
            onClick={() => { switchTab("map"); loadData(); }}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "map" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            MAP
          </button>
          <button
            onClick={() => { switchTab("fleet"); loadData(); }}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "fleet" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            FLEET
          </button>
          <button
            onClick={() => switchTab("campaigns")}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "campaigns" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            CAMPAIGNS
          </button>
          {userRole === "SUPER_ADMIN" && (
            <>
              <button
                onClick={() => switchTab("pricing")}
                className={`rounded-md px-6 py-2 transition ${
                  activeTab === "pricing" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                DEAL DESK
              </button>
              <button
                onClick={() => switchTab("settings")}
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
          <span>Ver 3.0.0</span>
        </div>
      </nav>

      <main className="p-0">
        <SystemStatus />
        <ExecutiveStats
          viewMode={viewMode}
          userRole={userRole}
          profile={profile}
          dataScopeOrgId={dataScopeOrgId}
          organizations={organizations}
          tokens={tokens}
          fleetScopeTotal={fleetScopeTotal}
          fleetScopeFound={fleetScopeFound}
          responsesCount={responsesCount}
        />
        {/* Map access is not RBAC; only which tokens are shown is (MapView filters by orgId). canReset is the only permission on the map (Reset button). */}
        {activeTab === "map" && (
          <div className="flex w-full flex-1 flex-col min-h-[480px]" style={{ height: "calc(100vh - 72px - 8rem)" }}>
            <MapView
              mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""}
              onTokenClick={(id) => setFleetDetailTokenId(id)}
              organizations={organizations.map((o) => ({ id: o.id, name: o.name }))}
              campaigns={campaigns.filter((c) => !c.deleted_at).map((c) => ({ id: c.id, name: c.name }))}
              selectedCampaignId={mapCampaignId}
              onCampaignChange={setMapCampaignId}
              selectedOrgId={dataScopeOrgId}
              onOrgChange={(id) => {
                setSelectedOrgId(id ?? null);
                setViewMode(id ? "TENANT" : "GLOBAL");
              }}
            />
          </div>
        )}

        {activeTab === "fleet" && (
          <FleetTab
            tokens={normalizeTokensWithCampaign(fleetRows)}
            campaigns={campaigns.filter((c) => !c.deleted_at)}
            selectedTokenIds={selectedTokenIds}
            setSelectedTokenIds={setSelectedTokenIds}
            targetCampaignId={targetCampaignId}
            setTargetCampaignId={setTargetCampaignId}
            onAssign={assignTokens}
            assignCampaignLoading={assignCampaignLoading}
            onRefresh={() => loadFleetList(fleetPage)}
            orgId={orgId}
            userRole={userRole}
            profile={profile}
            organizations={organizations}
            targetSchoolId={targetSchoolId}
            setTargetSchoolId={setTargetSchoolId}
            onAssignToSchool={assignTokensToSchool}
            assignToSchoolMessage={assignToSchoolMessage}
            assignCampaignMessage={assignCampaignMessage}
            fleetWrite={effectivePermissions.fleetWrite}
            fleetTotal={fleetTotal}
            fleetPage={fleetPage}
            setFleetPage={setFleetPage}
            fleetPageSize={fleetPageSize}
            setFleetPageSize={setFleetPageSize}
            fleetLoading={fleetLoading}
            fleetError={fleetError}
            onRetryFleet={() => loadFleetList(fleetPage)}
            fleetCampaignIdFilter={fleetCampaignIdFilter}
            setFleetCampaignIdFilter={(v) => { setFleetCampaignIdFilter(v); setFleetPage(1); }}
            fleetTokenCountByCampaignId={fleetTokenCountByCampaignId}
            fleetStatusFilter={fleetStatusFilter}
            setFleetStatusFilter={(v) => { setFleetStatusFilter(v); setFleetPage(1); }}
            fleetSearchQuery={fleetSearchQuery}
            setFleetSearchQuery={(v) => { setFleetSearchQuery(v); setFleetPage(1); }}
            fleetOrderBy={fleetOrderBy}
            setFleetOrderBy={(v) => { setFleetOrderBy(v); setFleetPage(1); }}
            fleetOrderDir={fleetOrderDir}
            setFleetOrderDir={(v) => { setFleetOrderDir(v); setFleetPage(1); }}
            onSearchFleet={() => loadFleetList(1)}
            onExportFleet={async () => {
              const ids = Array.from(selectedTokenIds);
              if (ids.length === 0) return;
              setExportFleetLoading(true);
              setFleetError("");
              try {
                const res = await exportClaimUrls(ids);
                if (res.success) {
                  setFleetError("");
                  setExportFleetMessage({ type: "success", text: `Exported ${ids.length} URL(s).` });
                  setTimeout(() => setExportFleetMessage(null), 4000);
                  const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `claim-urls-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } else {
                  setFleetError(res.error ?? "Export failed.");
                }
              } finally {
                setExportFleetLoading(false);
              }
            }}
            exportFleetLoading={exportFleetLoading}
            fleetAuditEvents={fleetAuditEvents}
            fleetAuditOpen={fleetAuditOpen}
            setFleetAuditOpen={setFleetAuditOpen}
            onLoadFleetAudit={async () => {
              const res = await getFleetAuditLog(20);
              if (res.success) setFleetAuditEvents(res.events);
            }}
            onReloadToken={handleReloadToken}
            reloadingTokenId={reloadingTokenId}
            onDeleteToken={handleDeleteToken}
            onFundToken={handleFundToken}
            onBulkLoadFunds={handleBulkLoadFunds}
            bulkLoadAmount={bulkLoadAmount}
            setBulkLoadAmount={setBulkLoadAmount}
            bulkLoadSubmitting={bulkLoadSubmitting}
            bulkLoadMessage={bulkLoadMessage}
            exportFleetMessage={exportFleetMessage}
            isSuperAdmin={userRole === "SUPER_ADMIN"}
            setFleetDetailTokenId={setFleetDetailTokenId}
          />
        )}

        {activeTab === "campaigns" && (
          <CampaignsTab
            campaigns={campaigns}
            onRefresh={loadData}
            orgId={orgId}
            dataScopeOrgId={dataScopeOrgId}
            organizations={organizations}
            userRole={userRole}
            campaignsWrite={effectivePermissions.campaignsWrite}
            showArchivedCampaigns={showArchivedCampaigns}
            setShowArchivedCampaigns={setShowArchivedCampaigns}
          />
        )}

        {activeTab === "pricing" && userRole === "SUPER_ADMIN" && <DealDeskContent />}

        {activeTab === "settings" && userRole === "SUPER_ADMIN" && (
          <SettingsTab
            organizations={organizationsForSettings}
            onRefreshOrganizations={refreshOrganizationsForSettings}
            rolePermissions={rolePermissions}
            onRefresh={() => getRolePermissions().then(setRolePermissions)}
            onTokensCreated={() => loadFleetList(1)}
          />
        )}

        {/* Fleet asset detail modal (opened from Fleet tab row click or Map tab pin click) */}
        {fleetDetailTokenId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fleet-detail-title"
            onClick={(e) => { if (e.target === e.currentTarget) setFleetDetailTokenId(null); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setFleetDetailTokenId(null); } }}
          >
            <div ref={fleetDetailModalRef} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-accent bg-muted shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                <h2 id="fleet-detail-title" className="text-lg font-bold">Asset details</h2>
                <button
                  type="button"
                  onClick={() => setFleetDetailTokenId(null)}
                  className="rounded border border-white/10 bg-background px-3 py-1 text-xs font-mono text-muted-foreground hover:bg-white/5"
                >
                  Close
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {fleetDetailLoading && (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
                {fleetDetailError && !fleetDetailToken && (
                  <p className="text-sm text-destructive">{fleetDetailError}</p>
                )}
                {fleetDetailToken && (
                  <div className="space-y-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-muted-foreground">Asset ID</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs break-all">{fleetDetailToken.id}</span>
                        <button type="button" onClick={() => copyToClipboard(fleetDetailToken.id)} className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground" title="Copy ID">Copy</button>
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Status</span>
                      <span className={fleetDetailToken.status === "active" ? "rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400" : "rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase bg-white/5 text-muted-foreground"}>
                        {fleetDetailToken.status === "active" ? "Active (value sitting)" : "Redeemed"}
                      </span>
                    </div>
                    {fleetDetailToken.status === "active" && fleetDetailToken.created_at && (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Value sitting since</span>
                        <span className="text-xs">{new Date(fleetDetailToken.created_at).toLocaleString()}</span>
                      </div>
                    )}
                    {fleetDetailToken.redeemer && (fleetDetailToken.redeemer.first_name || fleetDetailToken.redeemer.last_name || fleetDetailToken.redeemer.student_email || fleetDetailToken.redeemer.student_id) && (
                      <>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Redeemed by (name)</span>
                          <span className="text-xs">{[fleetDetailToken.redeemer.first_name, fleetDetailToken.redeemer.last_name].filter(Boolean).join(" ") || "—"}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Redeemed by (email)</span>
                          <span className="text-xs break-all">{fleetDetailToken.redeemer.student_email || "—"}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Redeemed by (student ID)</span>
                          <span className="text-xs font-mono">{fleetDetailToken.redeemer.student_id || "—"}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Organization</span>
                      <span>{fleetDetailToken.organizations?.name ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Active campaign</span>
                      <span className="font-bold text-success">{fleetDetailToken.campaigns?.name ?? "Unassigned"}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Balance</span>
                      <span className="font-mono">{fleetDetailToken.balance != null ? `$${fleetDetailToken.balance}` : "$0"}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Coordinates</span>
                      <span className="font-mono text-xs">{fleetDetailToken.lat.toFixed(4)}, {fleetDetailToken.lng.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Created</span>
                      <span className="text-xs">{fleetDetailToken.created_at ? new Date(fleetDetailToken.created_at).toLocaleString() : "—"}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Last tapped (redeemed)</span>
                      <span className="text-xs">{fleetDetailToken.redeemed_at ? new Date(fleetDetailToken.redeemed_at).toLocaleString() : "—"}</span>
                    </div>
                    {fleetDetailToken.reloaded_at && (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Reloaded at</span>
                        <span className="text-xs">{new Date(fleetDetailToken.reloaded_at).toLocaleString()}</span>
                      </div>
                    )}
                    {fleetDetailToken.status === "active" && fleetDetailToken.first_redeemer && (fleetDetailToken.first_redeemer.first_name || fleetDetailToken.first_redeemer.last_name || fleetDetailToken.first_redeemer.student_email || fleetDetailToken.first_redeemer.student_id) && (
                      <>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">First redeemed by (name)</span>
                          <span className="text-xs">{[fleetDetailToken.first_redeemer.first_name, fleetDetailToken.first_redeemer.last_name].filter(Boolean).join(" ") || "—"}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">First redeemed by (email)</span>
                          <span className="text-xs break-all">{fleetDetailToken.first_redeemer.student_email || "—"}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">First redeemed by (student ID)</span>
                          <span className="text-xs font-mono">{fleetDetailToken.first_redeemer.student_id || "—"}</span>
                        </div>
                      </>
                    )}
                    {fleetDetailToken.claim_url ? (
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="text-muted-foreground">Claim URL</span>
                        <span className="font-mono text-xs break-all text-muted-foreground">{fleetDetailToken.claim_url}</span>
                        <button type="button" onClick={() => copyToClipboard(fleetDetailToken.claim_url!)} className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground" title="Copy URL">Copy</button>
                      </div>
                    ) : fleetDetailToken.claim_url_restricted ? (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Claim URL</span>
                        <span className="italic text-muted-foreground">(restricted)</span>
                      </div>
                    ) : null}
                    {userRole === "SUPER_ADMIN" && (
                      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                        <span className="text-muted-foreground text-xs">Load funds to this token ($1–$25)</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={25}
                            step={1}
                            value={fleetDetailFundAmount}
                            onChange={(e) => setFleetDetailFundAmount(e.target.value)}
                            className="w-24 rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-sm"
                          />
                          <button
                            type="button"
                            disabled={fleetDetailFunding}
                            onClick={async () => {
                              const amt = Number(fleetDetailFundAmount);
                              if (!Number.isFinite(amt) || amt < 1 || amt > 25 || !fleetDetailTokenId) return;
                              if (fleetDetailToken.status === "found") {
                                const confirmed = window.confirm(
                                  "This token has already been redeemed. Adding funds will not change who redeemed it. Add funds anyway?"
                                );
                                if (!confirmed) return;
                              }
                              setFleetDetailFunding(true);
                              const ok = await handleFundToken(fleetDetailTokenId, amt);
                              setFleetDetailFunding(false);
                              if (ok) {
                                const res = await getToken(fleetDetailTokenId);
                                if (res.success && res.token) setFleetDetailToken(res.token);
                              }
                            }}
                            className="rounded border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            {fleetDetailFunding ? "Loading…" : "Load funds"}
                          </button>
                        </div>
                      </div>
                    )}
                    {userRole === "SUPER_ADMIN" && (fleetDetailToken.balance == null || fleetDetailToken.balance === 0) && (
                      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                        {!fleetDetailDeleteConfirm ? (
                          <button
                            type="button"
                            onClick={() => setFleetDetailDeleteConfirm(true)}
                            className="rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20"
                          >
                            Delete token
                          </button>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Remove permanently?</span>
                            <button
                              type="button"
                              disabled={fleetDetailDeleting}
                              onClick={async () => {
                                if (!fleetDetailTokenId) return;
                                setFleetDetailDeleting(true);
                                const ok = await handleDeleteToken(fleetDetailTokenId);
                                setFleetDetailDeleting(false);
                                setFleetDetailDeleteConfirm(false);
                                if (ok) setFleetDetailTokenId(null);
                              }}
                              className="rounded border border-red-500/50 bg-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                            >
                              {fleetDetailDeleting ? "Deleting…" : "Yes, delete"}
                            </button>
                            <button
                              type="button"
                              disabled={fleetDetailDeleting}
                              onClick={() => { setFleetDetailDeleteConfirm(false); }}
                              className="rounded border border-white/10 px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
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

/** All stages for System Health tooltip (rate range + ARR). */
const SYSTEM_HEALTH_STAGES = [
  { name: "Normal", rateRange: "> 2.0%", arr: "12%" },
  { name: "Steady", rateRange: "1.5% - 2.0%", arr: "Reduced" },
  { name: "Efficient", rateRange: "0.1% - 1.5%", arr: "Waived" },
  { name: "Freeze", rateRange: "0.0%", arr: "0%" },
] as const;

/** Mock current yield rate (3.60% = BENJI rate until API connection). Replace with real API hook later. */
const MOCK_CURRENT_YIELD = 3.6;

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
      <div className="flex items-center gap-2 text-xs font-mono">
        <div className={`h-2 w-2 rounded-full ${dotColor} ${pulseClass}`} />
        <span className={textColor}>
          System Health: {zone.name}
        </span>
        <span className="relative inline-flex">
          <button
            type="button"
            aria-label="System health zones and how they affect the system"
            className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-accent/60 bg-background text-[10px] leading-none text-muted-foreground hover:bg-background/80 focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-help"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onFocus={() => setShowTooltip(true)}
            onBlur={() => setShowTooltip(false)}
          >
            ?
          </button>
          {showTooltip && (
            <span
              role="tooltip"
              className="absolute left-0 top-full z-[9999] mt-1 w-80 max-w-[90vw] rounded-lg border border-accent bg-muted p-2.5 text-left text-xs text-foreground shadow-lg"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            >
              <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                Current: {currentYield.toFixed(2)}%
              </span>
              {SYSTEM_HEALTH_STAGES.map((s) => (
                <span key={s.name} className="block text-[11px] leading-relaxed">
                  {s.name} — {s.rateRange} · ARR {s.arr}
                </span>
              ))}
            </span>
          )}
        </span>
      </div>
      <div className="text-xs font-mono text-slate-500">
        Updated: {timeString}
      </div>
    </div>
  );
}

const STAT_TREND_POSITIVE = "flex items-center gap-1 text-[10px] font-mono text-emerald-400";
const STAT_TREND_NEGATIVE = "flex items-center gap-1 text-[10px] font-mono text-red-400";

function ExecutiveStatTrend({ value, positive }: { value: number; positive: boolean }) {
  return (
    <span className={positive ? STAT_TREND_POSITIVE : STAT_TREND_NEGATIVE}>
      {positive ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {positive ? "+" : ""}{value}%
    </span>
  );
}

function ExecutiveStats({
  viewMode,
  userRole,
  dataScopeOrgId,
  organizations,
  tokens,
  fleetScopeTotal,
  fleetScopeFound,
  responsesCount,
}: {
  viewMode: ViewMode;
  userRole: string | undefined;
  profile?: { email?: string | null; first_name?: string | null; last_name?: string | null; role: string; organization_id: string | null } | null;
  dataScopeOrgId: string | null;
  organizations: { id: string; name: string }[];
  tokens: TokenWithCampaign[];
  fleetScopeTotal?: number | null;
  fleetScopeFound?: number | null;
  responsesCount: number;
}) {
  const totalCount =
    fleetScopeTotal != null && fleetScopeFound != null
      ? fleetScopeTotal
      : tokens.length;
  const foundCount =
    fleetScopeFound != null ? fleetScopeFound : tokens.filter((t) => t.status === "found").length;
  const activeCount =
    fleetScopeTotal != null && fleetScopeFound != null
      ? fleetScopeTotal - fleetScopeFound
      : tokens.filter((t) => t.status === "active").length;
  const totalYieldDisbursed = foundCount * 25;
  const campusLiquidity = activeCount * MOCK_USD_PER_ACTIVE_TOKEN;
  const yieldEarned = Math.round(campusLiquidity * TENANT_APY);

  const orgName =
    dataScopeOrgId != null
      ? organizations.find((o) => o.id === dataScopeOrgId)?.name ?? "Campus"
      : null;
  /** First segment of "You are" identity: org name, or OFFBEAT OPTIONS when global. */
  const identityOrgLabel =
    viewMode === "GLOBAL" || !orgName ? "OFFBEAT OPTIONS" : orgName;
  const identityLabel =
    userRole === "SUPER_ADMIN"
      ? viewMode === "GLOBAL"
        ? `${identityOrgLabel} · SUPER_ADMIN · GLOBAL`
        : orgName
          ? `${identityOrgLabel} · SUPER_ADMIN · ${orgName}`
          : `${identityOrgLabel} · SUPER_ADMIN · TENANT`
      : orgName
        ? `${identityOrgLabel} · ${userRole ?? "User"} · ${orgName}`
        : `${identityOrgLabel} · ${userRole ?? "User"}`;

  const statClass = "flex flex-col gap-0.5 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 backdrop-blur-sm";
  const labelClass = "text-[10px] font-medium uppercase tracking-wider text-muted-foreground";
  const valueClass = "font-mono text-base font-bold tabular-nums text-white";

  if (viewMode === "GLOBAL") {
    const globalAumTrend = { value: 2.4, positive: true };
    const treasuryYieldTrend = { value: 12.1, positive: true };
    const activeCampusesTrend = { value: 0, positive: true };
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 bg-slate-900/40 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2 rounded-lg bg-slate-900/50 px-3 py-1.5 backdrop-blur-sm">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">You are</span>
          <span className="font-mono text-sm font-semibold text-white">{identityLabel}</span>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className={statClass}>
            <span className={labelClass}>Global AUM</span>
            <span className={valueClass}>$1.2M</span>
            <ExecutiveStatTrend value={globalAumTrend.value} positive={globalAumTrend.positive} />
          </div>
          <div className={statClass}>
            <span className={labelClass}>Net Treasury Yield</span>
            <span className={valueClass}>+$4,250</span>
            <ExecutiveStatTrend value={treasuryYieldTrend.value} positive={treasuryYieldTrend.positive} />
          </div>
          <div className={statClass}>
            <span className={labelClass}>Active Campuses</span>
            <span className={valueClass}>12</span>
            <ExecutiveStatTrend value={activeCampusesTrend.value} positive={activeCampusesTrend.positive} />
          </div>
          <div className={statClass}>
            <span className={labelClass}>Total Assets (scope)</span>
            <span className={valueClass}>{totalCount}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-4 py-2 backdrop-blur-sm">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
            Live
          </span>
          <div className="flex items-center gap-4 border-l border-white/10 pl-3">
            <div className="text-right">
              <div className="font-mono text-lg font-bold tabular-nums text-white animate-pulse">
                ${totalYieldDisbursed.toFixed(2)}
              </div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-400">Total Yield Disbursed</div>
            </div>
            <div className="border-l border-white/10 pl-4 text-right">
              <div className="font-mono text-lg font-bold tabular-nums text-white animate-pulse">
                {activeCount} / {totalCount}
              </div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Active Assets</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const campusLiquidityTrend = { value: 5.2, positive: true };
  const yieldEarnedTrend = { value: 8.3, positive: true };
  const activeFleetTrend = { value: 3, positive: true };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/5 bg-slate-900/40 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-2 rounded-lg bg-slate-900/50 px-3 py-1.5 backdrop-blur-sm">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">You are</span>
        <span className="font-mono text-sm font-semibold text-white">{identityLabel}</span>
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-3">
        <div className={statClass}>
          <span className={labelClass}>Campus Liquidity</span>
          <span className={valueClass}>${campusLiquidity.toLocaleString("en-US")}</span>
          <ExecutiveStatTrend value={campusLiquidityTrend.value} positive={campusLiquidityTrend.positive} />
        </div>
        <div className={statClass}>
          <span className={labelClass}>Yield Earned</span>
          <span className={valueClass}>+${yieldEarned.toLocaleString("en-US")}</span>
          <ExecutiveStatTrend value={yieldEarnedTrend.value} positive={yieldEarnedTrend.positive} />
        </div>
        <div className={statClass}>
          <span className={labelClass}>Active Fleet</span>
          <span className={valueClass}>{activeCount}</span>
          <ExecutiveStatTrend value={activeFleetTrend.value} positive={activeFleetTrend.positive} />
        </div>
        <div className={statClass}>
          <span className={labelClass}>Claimed</span>
          <span className={valueClass}>{foundCount}</span>
        </div>
        <div className={statClass}>
          <span className={labelClass}>Redemptions</span>
          <span className={valueClass}>{responsesCount}</span>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-4 py-2 backdrop-blur-sm">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
          Live
        </span>
        <div className="flex items-center gap-4 border-l border-white/10 pl-3">
          <div className="text-right">
            <div className="font-mono text-lg font-bold tabular-nums text-white animate-pulse">
              ${totalYieldDisbursed.toFixed(2)}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-400">Total Yield Disbursed</div>
          </div>
          <div className="border-l border-white/10 pl-4 text-right">
            <div className="font-mono text-lg font-bold tabular-nums text-white animate-pulse">
              {activeCount} / {totalCount}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Active Assets</div>
          </div>
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
  assignCampaignLoading,
  onRefresh,
  orgId: _orgId,
  userRole,
  profile,
  organizations,
  targetSchoolId,
  setTargetSchoolId,
  onAssignToSchool,
  assignToSchoolMessage,
  assignCampaignMessage,
  fleetWrite,
  fleetTotal,
  fleetPage,
  setFleetPage,
  fleetPageSize,
  setFleetPageSize,
  fleetLoading,
  fleetError,
  onRetryFleet,
  fleetCampaignIdFilter,
  setFleetCampaignIdFilter,
  fleetTokenCountByCampaignId,
  fleetStatusFilter,
  setFleetStatusFilter,
  fleetSearchQuery,
  setFleetSearchQuery,
  fleetOrderBy,
  setFleetOrderBy,
  fleetOrderDir,
  setFleetOrderDir,
  onSearchFleet,
  onExportFleet,
  exportFleetLoading,
  fleetAuditEvents,
  fleetAuditOpen,
  setFleetAuditOpen,
  onLoadFleetAudit,
  onReloadToken,
  reloadingTokenId,
  onDeleteToken: _onDeleteToken,
  onFundToken: _onFundToken,
  onBulkLoadFunds,
  bulkLoadAmount = "25",
  setBulkLoadAmount,
  bulkLoadSubmitting = false,
  bulkLoadMessage = null,
  exportFleetMessage = null,
  isSuperAdmin,
  setFleetDetailTokenId,
}: {
  tokens: TokenWithCampaign[];
  campaigns: Campaign[];
  selectedTokenIds: Set<string>;
  setSelectedTokenIds: (s: Set<string>) => void;
  targetCampaignId: string;
  setTargetCampaignId: (id: string) => void;
  onAssign: () => void;
  assignCampaignLoading?: boolean;
  onRefresh: () => void;
  orgId: string | null;
  userRole: string | undefined;
  profile: { role: string; organization_id: string | null } | null;
  organizations: Organization[];
  targetSchoolId: string;
  setTargetSchoolId: (id: string) => void;
  onAssignToSchool: () => void;
  assignToSchoolMessage: { type: "success" | "error"; text: string } | null;
  assignCampaignMessage: { type: "success" | "error"; text: string } | null;
  fleetWrite: boolean;
  fleetTotal?: number;
  fleetPage?: number;
  setFleetPage?: (p: number) => void;
  fleetPageSize?: number;
  setFleetPageSize?: (n: number) => void;
  fleetLoading?: boolean;
  fleetError?: string;
  onRetryFleet?: () => void;
  fleetCampaignIdFilter?: string;
  setFleetCampaignIdFilter?: (v: string) => void;
  fleetTokenCountByCampaignId?: Record<string, number>;
  fleetStatusFilter?: "all" | "active" | "found";
  setFleetStatusFilter?: (v: "all" | "active" | "found") => void;
  fleetSearchQuery?: string;
  setFleetSearchQuery?: (v: string) => void;
  fleetOrderBy?: FleetOrderBy;
  setFleetOrderBy?: (v: FleetOrderBy) => void;
  fleetOrderDir?: FleetOrderDir;
  setFleetOrderDir?: (v: FleetOrderDir) => void;
  onSearchFleet?: () => void;
  onExportFleet?: () => void;
  exportFleetLoading?: boolean;
  fleetAuditEvents?: { event_type: string; at: string; actor_user_id: string | null; payload?: Record<string, unknown> | null }[];
  fleetAuditOpen?: boolean;
  setFleetAuditOpen?: (v: boolean) => void;
  onLoadFleetAudit?: () => void;
  onReloadToken?: (tokenId: string) => void;
  reloadingTokenId?: string | null;
  onDeleteToken?: (tokenId: string) => Promise<boolean>;
  onFundToken?: (tokenId: string, amount: number) => Promise<boolean>;
  onBulkLoadFunds?: (amount: number) => Promise<boolean>;
  bulkLoadAmount?: string;
  setBulkLoadAmount?: (v: string) => void;
  bulkLoadSubmitting?: boolean;
  bulkLoadMessage?: { type: "success" | "error"; text: string } | null;
  exportFleetMessage?: { type: "success"; text: string } | null;
  isSuperAdmin?: boolean;
  setFleetDetailTokenId: (id: string | null) => void;
}) {
  const [showFleetTermsTooltip, setShowFleetTermsTooltip] = useState(false);
  const [fleetConfirmDialog, setFleetConfirmDialog] = useState<
    { type: "transfer"; message: string } | { type: "bulkFundRedeemed"; message: string; amount: number } | null
  >(null);
  const [copiedIdTokenId, setCopiedIdTokenId] = useState<string | null>(null);
  const campaignIdUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const toggleOne = (id: string) => {
    const next = new Set(selectedTokenIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTokenIds(next);
  };
  const toggleAll = (checked: boolean) => {
    setSelectedTokenIds(checked ? new Set(tokens.map((t) => t.id)) : new Set());
  };
  const effectiveSuperAdmin = isSuperAdmin ?? userRole === "SUPER_ADMIN";
  const isAuditor = userRole === "AUDITOR";
  const showFleetWrite = (fleetWrite || effectiveSuperAdmin) && !isAuditor;
  const showOrgColumn = effectiveSuperAdmin || isAuditor;
  const canAssignToSchool = effectiveSuperAdmin || (userRole === "ORG_ADMIN" && !!profile?.organization_id);
  const showAudit = effectiveSuperAdmin;
  const maxPage = (fleetPageSize ?? 25) > 0 ? Math.max(1, Math.ceil((fleetTotal ?? 0) / (fleetPageSize ?? 25))) : 1;

  const copyToClipboard = (text: string, _label: string) => {
    navigator.clipboard.writeText(text).then(
      () => {},
      () => {}
    );
  };

  return (
    <div className="mx-auto max-w-[98vw] space-y-10 px-4 py-8 font-sans">
      <section className="rounded-2xl border border-accent bg-muted p-6">
        <div className="mb-6 flex min-h-20 w-full flex-shrink-0 flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fleet Management</h2>
              <p className="text-sm text-muted-foreground">View and manage fleet assets. Filter by campaign or status, assign campaign, transfer organization, or export claim URLs from row actions.</p>
            </div>
            <span className="relative inline-flex">
            <button
              type="button"
              aria-label="Fleet and command center terms"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-help"
              onMouseEnter={() => setShowFleetTermsTooltip(true)}
              onMouseLeave={() => setShowFleetTermsTooltip(false)}
              onFocus={() => setShowFleetTermsTooltip(true)}
              onBlur={() => setShowFleetTermsTooltip(false)}
            >
              <Info className="h-4 w-4" aria-hidden />
            </button>
            {showFleetTermsTooltip && (
              <span
                role="tooltip"
                className="absolute left-0 top-full z-[9999] mt-1 w-72 max-w-[90vw] rounded-lg border border-accent bg-muted p-3 text-left text-xs text-foreground shadow-lg"
                onMouseEnter={() => setShowFleetTermsTooltip(true)}
                onMouseLeave={() => setShowFleetTermsTooltip(false)}
              >
                <span className="mb-1.5 block font-semibold text-muted-foreground">Command center terms</span>
                <dl className="space-y-1.5 text-[11px] leading-relaxed">
                  <div><dt className="font-medium">Fleet</dt><dd className="text-muted-foreground">The set of tokens you manage in this view (all or scoped to one organization).</dd></div>
                  <div><dt className="font-medium">Token</dt><dd className="text-muted-foreground">A unique claimable item with a stable ID (UUID). One claim URL per token; students use it to submit a claim.</dd></div>
                  <div><dt className="font-medium">Asset</dt><dd className="text-muted-foreground">Same as token — used in this UI (e.g. &quot;Select asset&quot;, &quot;Active assets&quot;) for clarity in the command center.</dd></div>
                </dl>
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {showFleetWrite && setFleetCampaignIdFilter && setFleetStatusFilter && (
            <div className="flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2">
              <select
                aria-label="Filter by campaign"
                value={fleetCampaignIdFilter ?? ""}
                onChange={(e) => setFleetCampaignIdFilter(e.target.value)}
                className="h-9 w-48 rounded border border-accent bg-background/50 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">All campaigns</option>
                {campaigns
                  .filter((c) => typeof c.id === "string" && campaignIdUuidRegex.test(c.id))
                  .map((c) => {
                    const n = fleetTokenCountByCampaignId?.[c.id];
                    const label = typeof n === "number" ? `${String(c.name ?? "")} (${n} assets)` : String(c.name ?? "");
                    return (
                      <option key={c.id} value={c.id}>{label}</option>
                    );
                  })}
              </select>
              <select
                aria-label="Filter by status"
                value={fleetStatusFilter ?? "all"}
                onChange={(e) => setFleetStatusFilter(e.target.value as "all" | "active" | "found")}
                className="h-9 w-28 rounded border border-accent bg-background/50 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="found">Found</option>
              </select>
              <label htmlFor="fleet-search-uuid" className="sr-only">Search by asset ID</label>
              <input
                id="fleet-search-uuid"
                type="text"
                placeholder="Search by asset ID"
                value={fleetSearchQuery ?? ""}
                onChange={(e) => setFleetSearchQuery?.(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchFleet?.(); } }}
                className="h-9 w-56 rounded border border-accent bg-background/50 px-2 text-sm font-mono placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20"
              />
              {onSearchFleet && (
                <button
                  type="button"
                  onClick={onSearchFleet}
                  className="h-9 rounded border border-accent bg-background/40 px-3 text-sm hover:bg-background/60"
                >
                  Search
                </button>
              )}
            </div>
          )}
          {showFleetWrite && (
            <div className="flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2">
              <select
                id="fleet-target-campaign"
                name="fleetTargetCampaign"
                aria-label="Select campaign to assign"
                value={targetCampaignId}
                onChange={(e) => setTargetCampaignId(e.target.value)}
                className="h-9 w-64 min-w-[14rem] rounded border border-accent bg-background/50 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select Campaign to Assign...</option>
                <option value="__unassign__">Clear Campaign (Unassigned)</option>
                {campaigns
                  .filter((c) => typeof c.id === "string" && c.id.length > 0 && campaignIdUuidRegex.test(c.id))
                  .map((c) => {
                    const n = fleetTokenCountByCampaignId?.[c.id];
                    const label = typeof n === "number" ? `${String(c.name ?? "")} (${n} assets)` : String(c.name ?? "");
                    return (
                      <option key={c.id} value={c.id}>{label}</option>
                    );
                  })}
              </select>
              <button
                onClick={onAssign}
                disabled={!targetCampaignId || selectedTokenIds.size === 0 || assignCampaignLoading}
                className="h-9 rounded bg-primary px-4 text-sm font-medium tracking-wide text-primary-foreground disabled:opacity-50"
              >
                {assignCampaignLoading ? "Updating…" : "Set Campaign"}
              </button>
            </div>
          )}
          {canAssignToSchool && (
            <div className="flex items-center gap-2 rounded border border-amber-500/20 bg-background/40 px-3 py-2">
              {effectiveSuperAdmin && (
                <>
                  <select
                    id="fleet-target-organization"
                    name="fleetTargetOrganization"
                    aria-label="Select organization to transfer fleet to"
                    value={targetSchoolId}
                    onChange={(e) => setTargetSchoolId(e.target.value)}
                    className="h-9 w-64 min-w-[14rem] rounded border border-accent bg-background/50 text-sm outline-none focus:ring-2 focus:ring-primary/20"
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
                onClick={() => {
                  if (!targetSchoolId || selectedTokenIds.size === 0) return;
                  setFleetConfirmDialog({
                    type: "transfer",
                    message: "This will move selected tokens to another organization. Tokens are tethered to their claim URL and current organization. Continue?",
                  });
                }}
                disabled={!targetSchoolId || selectedTokenIds.size === 0}
                className="h-9 rounded border border-amber-500/50 px-4 text-sm font-medium text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
              >
                Transfer Fleet
              </button>
            </div>
          )}
          {showFleetWrite && onExportFleet && (
            <button
              onClick={onExportFleet}
              disabled={selectedTokenIds.size === 0 || exportFleetLoading}
              className="h-9 rounded border border-accent bg-background/40 px-4 text-sm hover:bg-background/60 disabled:opacity-50"
            >
              {exportFleetLoading ? "Exporting…" : "Export URLs"}
            </button>
          )}
          {selectedTokenIds.size > 0 && (
            <div className="flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2">
              <span className="text-muted-foreground text-xs whitespace-nowrap">{selectedTokenIds.size} selected</span>
              <button
                type="button"
                onClick={() => setSelectedTokenIds(new Set())}
                className="h-9 rounded border border-accent bg-background/40 px-3 text-xs hover:bg-background/60 disabled:opacity-50"
              >
                Clear selection
              </button>
            </div>
          )}
          {isSuperAdmin && selectedTokenIds.size > 0 && onBulkLoadFunds && setBulkLoadAmount && (
            <div className="flex items-center gap-2 rounded border border-emerald-500/20 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground text-xs whitespace-nowrap">Load funds to selected ({selectedTokenIds.size})</span>
              <input
                type="number"
                min={1}
                max={25}
                value={bulkLoadAmount}
                onChange={(e) => setBulkLoadAmount(e.target.value)}
                className="h-9 w-16 rounded border border-accent bg-background/50 px-2 text-sm text-right outline-none focus:ring-2 focus:ring-primary/20"
                aria-label="Amount per token ($1–$25)"
              />
              <span className="text-muted-foreground text-xs">$ each</span>
              <button
                type="button"
                onClick={() => {
                  const amt = Number(bulkLoadAmount);
                  if (!Number.isFinite(amt) || amt < 1 || amt > 25) return;
                  const redeemedCount = tokens.filter((t) => selectedTokenIds.has(t.id) && t.status === "found").length;
                  if (redeemedCount > 0) {
                    setFleetConfirmDialog({
                      type: "bulkFundRedeemed",
                      message: `${redeemedCount} of the selected token(s) have already been redeemed. Add funds to all anyway?`,
                      amount: amt,
                    });
                    return;
                  }
                  onBulkLoadFunds(amt);
                }}
                disabled={bulkLoadSubmitting}
                className="h-9 rounded bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {bulkLoadSubmitting ? "Loading…" : "Load funds"}
              </button>
            </div>
          )}
          <button
            onClick={onRefresh}
            className="h-9 rounded border border-accent bg-background/40 px-4 text-sm hover:bg-background/60"
          >
            Refresh database
          </button>
        </div>
      </div>

        {(assignToSchoolMessage || assignCampaignMessage || bulkLoadMessage || exportFleetMessage) && (
          <div
            className={`mb-4 rounded border px-4 py-2 text-sm ${
              (assignToSchoolMessage ?? assignCampaignMessage ?? bulkLoadMessage ?? exportFleetMessage)!.type === "success"
                ? "border-success bg-success/10 text-success"
                : "border-destructive bg-destructive/10 text-destructive"
            }`}
          >
            {(assignToSchoolMessage ?? assignCampaignMessage ?? bulkLoadMessage ?? exportFleetMessage)!.text}
          </div>
        )}

        {fleetError && (
          <div className="mb-4 rounded border border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {fleetError}
            {onRetryFleet && (
              <button type="button" onClick={onRetryFleet} className="ml-2 underline">
                Retry
              </button>
            )}
          </div>
        )}

        {/* Pagination + page size */}
        {typeof fleetTotal === "number" && setFleetPage && setFleetPageSize && (
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {fleetTotal} asset{fleetTotal !== 1 ? "s" : ""}
            </span>
            <select
              aria-label="Page size"
              value={fleetPageSize ?? 25}
              onChange={(e) => { setFleetPageSize(Number(e.target.value)); setFleetPage(1); }}
              className="h-8 rounded border border-accent bg-background/50 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => setFleetPage(Math.max(1, (fleetPage ?? 1) - 1))}
                disabled={(fleetPage ?? 1) <= 1 || fleetLoading}
                className="h-8 rounded border border-accent bg-background/40 px-2 text-sm hover:bg-background/60 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="flex items-center px-2 text-sm text-muted-foreground" aria-live="polite">
                Page {fleetPage ?? 1} of {maxPage}
              </span>
              <button
                type="button"
                aria-label="Next page"
                onClick={() => setFleetPage(Math.min(maxPage, (fleetPage ?? 1) + 1))}
                disabled={(fleetPage ?? 1) >= maxPage || fleetLoading}
                className="h-8 rounded border border-accent bg-background/40 px-2 text-sm hover:bg-background/60 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-accent/60 bg-background/20">
          {fleetLoading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <p className="text-sm text-muted-foreground">Loading fleet…</p>
            </div>
          ) : tokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <Box className="h-12 w-12 text-muted-foreground/60" strokeWidth={1.25} />
              <p className="text-sm text-muted-foreground">No assets in this scope.</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 text-xs uppercase text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-slate-900/80">
              <tr>
                <th className="p-4">
                  <input
                    name="fleetSelectAll"
                    aria-label="Select all on this page"
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
                <th className="p-4 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setFleetOrderBy?.("balance");
                      setFleetOrderDir?.(fleetOrderBy === "balance" && fleetOrderDir === "asc" ? "desc" : "asc");
                      setFleetPage?.(1);
                    }}
                    className="inline-flex items-center gap-1 text-xs uppercase font-medium hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 rounded"
                  >
                    Balance
                    {fleetOrderBy === "balance" && (fleetOrderDir === "asc" ? " ↑" : " ↓")}
                  </button>
                </th>
                <th className="p-4 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setFleetOrderBy?.("status");
                      setFleetOrderDir?.(fleetOrderBy === "status" && fleetOrderDir === "asc" ? "desc" : "asc");
                      setFleetPage?.(1);
                    }}
                    className="inline-flex items-center gap-1 text-xs uppercase font-medium hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 rounded"
                  >
                    Status
                    {fleetOrderBy === "status" && (fleetOrderDir === "asc" ? " ↑" : " ↓")}
                  </button>
                </th>
                <th className="p-4 text-right">Created</th>
                {showFleetWrite && <th className="p-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {tokens.map((t) => (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="p-4">
                    <input
                      name={`fleetSelect_${t.id}`}
                      aria-label={`Select asset ${t.id}`}
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
                  <td className="p-4 font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => setFleetDetailTokenId(t.id)}
                      title={t.id}
                      className="text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded text-left"
                    >
                      ...{t.id.slice(-8)}
                    </button>
                  </td>
                  <td className="p-4 font-mono text-xs text-muted-foreground">
                    {t.lat.toFixed(4)}, {t.lng.toFixed(4)}
                  </td>
                  <td className="p-4 font-bold text-success">
                    {t.campaigns?.name ?? "Unassigned"}
                  </td>
                  <td className="p-4 text-right font-mono text-xs">
                    {t.balance != null && t.balance > 0 ? (
                      <span className="text-emerald-400">${t.balance}</span>
                    ) : (
                      <span className="text-muted-foreground">$0</span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <span className={`rounded px-2 py-1 font-mono text-[10px] font-bold uppercase ${
                      t.status === "active"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-white/5 text-muted-foreground"
                    }`}>
                      {t.status === "active" ? "Active (waiting)" : "Redeemed"}
                    </span>
                  </td>
                  <td className="p-4 text-right text-xs text-muted-foreground">
                    {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}
                  </td>
                  {showFleetWrite && (
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        {effectiveSuperAdmin && t.status === "found" && (
                          <button
                            type="button"
                            onClick={() => onReloadToken?.(t.id)}
                            disabled={reloadingTokenId === t.id}
                            className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                            title="Reset status to active (does not set balance; use Load funds to add value)"
                          >
                            {reloadingTokenId === t.id ? "Reloading…" : "Reload"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            copyToClipboard(t.id, "ID");
                            setCopiedIdTokenId(t.id);
                            window.setTimeout(() => setCopiedIdTokenId(null), 1500);
                          }}
                          className={`rounded border px-2 py-1 text-xs transition-colors ${
                            copiedIdTokenId === t.id
                              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                              : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground"
                          }`}
                        >
                          {copiedIdTokenId === t.id ? "Copied!" : "Copy ID"}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            </table>
          )}
        </div>

      {/* In-app confirmation modal (transfer / bulk fund redeemed) */}
      {fleetConfirmDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fleet-confirm-title"
          onClick={(e) => { if (e.target === e.currentTarget) setFleetConfirmDialog(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setFleetConfirmDialog(null); } }}
        >
          <div className="w-full max-w-md rounded-2xl border border-accent bg-muted p-4 shadow-2xl">
            <h3 id="fleet-confirm-title" className="text-lg font-semibold text-foreground">Confirm</h3>
            <p className="mt-2 text-sm text-muted-foreground">{fleetConfirmDialog.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFleetConfirmDialog(null)}
                className="rounded border border-accent bg-background/40 px-4 py-2 text-sm hover:bg-background/60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (fleetConfirmDialog.type === "transfer") {
                    onAssignToSchool?.();
                  } else {
                    onBulkLoadFunds?.(fleetConfirmDialog.amount);
                  }
                  setFleetConfirmDialog(null);
                }}
                className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent activity (audit trail) — SuperAdmin only */}
      {showAudit && setFleetAuditOpen !== undefined && (
        <div className="mt-6 rounded-xl border border-accent/40 bg-background/20">
          <button
            type="button"
            onClick={() => {
              setFleetAuditOpen(!fleetAuditOpen);
              if (!fleetAuditOpen && onLoadFleetAudit) onLoadFleetAudit();
            }}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
          >
            Recent activity
            <span className="text-muted-foreground">{fleetAuditOpen ? "▼" : "▶"}</span>
          </button>
          {fleetAuditOpen && (
            <div className="border-t border-accent/40 px-4 py-3">
              {Array.isArray(fleetAuditEvents) && fleetAuditEvents.length > 0 ? (
                <ul className="space-y-2 text-xs">
                  {fleetAuditEvents.map((evt, i) => (
                    <li key={i} className="flex flex-wrap gap-2 text-muted-foreground">
                      <span className="font-mono font-medium text-white">{evt.event_type}</span>
                      <span>{new Date(evt.at).toLocaleString()}</span>
                      {evt.payload && typeof evt.payload === "object" && "count" in evt.payload && (
                        <span>count: {String((evt.payload as { count?: number }).count)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No recent fleet activity.</p>
              )}
            </div>
          )}
        </div>
      )}
      </section>
    </div>
  );
}

function CampaignsTab({
  campaigns,
  onRefresh,
  orgId,
  dataScopeOrgId,
  organizations,
  userRole,
  campaignsWrite,
  showArchivedCampaigns,
  setShowArchivedCampaigns,
}: {
  campaigns: Campaign[];
  onRefresh: () => void;
  orgId: string | null;
  dataScopeOrgId?: string | null;
  organizations: Organization[];
  userRole: string | undefined;
  campaignsWrite: boolean;
  showArchivedCampaigns: boolean;
  setShowArchivedCampaigns: (v: boolean) => void;
}) {
  const router = useRouter();
  const exampleCampaignName = "Student Union Pulse Check";
  const exampleQuestions = [
    "What year are you (Freshman / Sophomore / Junior / Senior / Grad)?",
    "How often do you use the Student Union each week?",
    "What’s the #1 thing you wish the Student Union had (food, study space, events, services, other)?",
    "How satisfied are you with campus dining options (1–5)?",
    "If you could change one thing about student life, what would it be?",
  ];

  const [name, setName] = useState("");
  const [questions, setQuestions] = useState<string[]>(Array.from({ length: 5 }, () => ""));
  const [saving, setSaving] = useState(false);
  const [createOrgId, setCreateOrgId] = useState<string>("");
  const [createError, setCreateError] = useState<string>("");

  // SUPER_ADMIN: server-side list with pagination and search
  const [listRows, setListRows] = useState<Campaign[]>([]);
  const [campaignTotal, setCampaignTotal] = useState(0);
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignPageSize, setCampaignPageSize] = useState(50);
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<
    "all" | "draft" | "active" | "inactive"
  >("all");
  const [campaignSearchQuery, setCampaignSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [showDeletedCampaigns, setShowDeletedCampaigns] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [batchActionError, setBatchActionError] = useState("");
  const [pinError, setPinError] = useState("");
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [duplicatingCampaignId, setDuplicatingCampaignId] = useState<string | null>(null);
  const [tokenCountByCampaignId, setTokenCountByCampaignId] = useState<Record<string, number>>({});

  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") return;
    const t = setTimeout(() => setDebouncedSearchQuery(campaignSearchQuery), 300);
    return () => clearTimeout(t);
  }, [campaignSearchQuery, userRole]);

  const loadCampaignsList = useCallback(
    async (overridePage?: number, getIsCancelled?: () => boolean) => {
      if (userRole !== "SUPER_ADMIN") return;
      const rawPage = overridePage ?? campaignPage;
      const pageToLoad =
        Number.isFinite(Number(rawPage)) && Number(rawPage) >= 1
          ? Math.floor(Number(rawPage))
          : 1;
      setLoadingCampaigns(true);
      setLoadError("");
      try {
        const res: ListCampaignsResult<Campaign> = await listCampaigns({
          page: pageToLoad,
          pageSize: campaignPageSize,
          searchQuery: debouncedSearchQuery,
          showArchived: showArchivedCampaigns,
          showDeleted: showDeletedCampaigns,
          status: campaignStatusFilter === "all" ? undefined : campaignStatusFilter,
        });
        if (getIsCancelled?.()) return;
        if (!res.success) {
          setLoadError(res.error ?? "Failed to load campaigns.");
          setListRows([]);
          setCampaignTotal(0);
          return;
        }
        setBatchActionError("");
        setListRows(Array.isArray(res.rows) ? res.rows : []);
        const rawTotal = res.total ?? 0;
        const total =
          typeof rawTotal === "number" && Number.isFinite(rawTotal) && rawTotal >= 0
            ? Math.floor(rawTotal)
            : 0;
        setCampaignTotal(total);
        const safeSize = campaignPageSize || 1;
        const maxPage = total === 0 ? 1 : Math.max(1, Math.ceil(total / safeSize));
        if (pageToLoad > maxPage) setCampaignPage(maxPage);
        else if (
          pageToLoad !== campaignPage &&
          Number.isFinite(Number(pageToLoad)) &&
          Number(pageToLoad) >= 1
        ) {
          setCampaignPage(Math.max(1, Math.floor(Number(pageToLoad))));
        }
      } catch {
        setLoadError("Failed to load campaigns.");
        setListRows([]);
        setCampaignTotal(0);
      } finally {
        setLoadingCampaigns(false);
      }
    },
    [
      userRole,
      campaignPage,
      campaignPageSize,
      campaignStatusFilter,
      debouncedSearchQuery,
      showArchivedCampaigns,
      showDeletedCampaigns,
    ]
  );

  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") return;
    let cancelled = false;
    loadCampaignsList(campaignPage, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [userRole, campaignPage, debouncedSearchQuery, showArchivedCampaigns, showDeletedCampaigns, campaignStatusFilter, loadCampaignsList]);

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

  async function createCampaignSubmit() {
    const trimmedName = String(name ?? "").trim();
    if (!trimmedName) return;
    const targetOrgId = orgId ?? (createOrgId || null);
    if (!targetOrgId) {
      setCreateError("Select an organization for this campaign.");
      return;
    }
    setCreateError("");
    const qs: CampaignQuestion[] = questions
      .map((text, order) => ({ order: order + 1, text: String(text ?? "").trim() }))
      .filter((q) => q.text.length > 0);
    setSaving(true);
    try {
      const res = await insertCampaign({
        name: trimmedName,
        organization_id: targetOrgId,
        required_fields: CAMPAIGN_REQUIRED_FIELDS,
        questions: qs.length ? qs : null,
      });
      if (res.success) {
        setName("");
        setQuestions(Array.from({ length: 5 }, () => ""));
        setCreateOrgId("");
        onRefresh();
        if (userRole === "SUPER_ADMIN") loadCampaignsList(1);
      } else {
        setCreateError(res.error ?? "Create failed.");
      }
    } catch {
      setCreateError("Create failed.");
    } finally {
      setSaving(false);
    }
  }

  const questionCount = (c: Campaign) =>
    Array.isArray(c.questions) ? c.questions.length : 0;
  const requiredCount = CAMPAIGN_REQUIRED_FIELDS.length;

  const useServerList = userRole === "SUPER_ADMIN";
  const displayCampaigns = useServerList ? listRows : campaigns;
  const safePageSize = campaignPageSize || 1;
  const campaignPageCount = useServerList ? Math.max(1, Math.ceil(campaignTotal / safePageSize)) : 1;
  const effectivePage =
    Number.isFinite(Number(campaignPage)) && Number(campaignPage) >= 1
      ? Math.min(campaignPageCount, Math.floor(Number(campaignPage)))
      : 1;
  const showingFrom = campaignTotal === 0 ? 0 : (effectivePage - 1) * safePageSize + 1;
  const showingTo = Math.min(campaignTotal, effectivePage * safePageSize);

  const campaignIdUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validDisplayIds = displayCampaigns
    .map((c) => c.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0 && campaignIdUuidRegex.test(id));
  const visibleCampaignIds = new Set(validDisplayIds);

  const displayIdsKey = validDisplayIds.length > 0 ? [...validDisplayIds].sort().join(",") : "";
  useEffect(() => {
    if (validDisplayIds.length === 0) {
      setTokenCountByCampaignId({});
      return;
    }
    let cancelled = false;
    getTokenCountsByCampaignIds(validDisplayIds, dataScopeOrgId ?? undefined).then((res) => {
      if (!cancelled && res.success) setTokenCountByCampaignId(res.counts);
      else if (!cancelled) setTokenCountByCampaignId({});
    });
    return () => {
      cancelled = true;
    };
  // validDisplayIds omitted to avoid refetch on every selection change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayIdsKey, dataScopeOrgId]);
  const selectedVisibleIds = [...selectedCampaignIds].filter((id) => visibleCampaignIds.has(id));

  function toggleCampaignSelection(id: string) {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllCampaigns(checked: boolean) {
    setSelectedCampaignIds(checked ? new Set(validDisplayIds) : new Set());
  }

  const validSelectedIds = selectedVisibleIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0 && campaignIdUuidRegex.test(id)
  );
  async function batchArchive() {
    if (validSelectedIds.length === 0) return;
    setBatchActionError("");
    setBatchActionLoading(true);
    try {
      const res = await archiveCampaigns(validSelectedIds, true);
      if (res.success) {
        setSelectedCampaignIds(new Set());
        loadCampaignsList(campaignPage);
      } else setBatchActionError(res.error ?? "Archive failed.");
    } catch {
      setBatchActionError("Archive failed.");
    } finally {
      setBatchActionLoading(false);
    }
  }
  async function batchDelete() {
    if (validSelectedIds.length === 0) return;
    setBatchActionError("");
    setBatchActionLoading(true);
    try {
      const res = await softDeleteCampaigns(validSelectedIds, true);
      if (res.success) {
        setSelectedCampaignIds(new Set());
        loadCampaignsList(campaignPage);
      } else setBatchActionError(res.error ?? "Delete failed.");
    } catch {
      setBatchActionError("Delete failed.");
    } finally {
      setBatchActionLoading(false);
    }
  }
  async function batchRestore() {
    if (validSelectedIds.length === 0) return;
    setBatchActionError("");
    setBatchActionLoading(true);
    try {
      const res = await softDeleteCampaigns(validSelectedIds, false);
      if (res.success) {
        setSelectedCampaignIds(new Set());
        loadCampaignsList(campaignPage);
      } else setBatchActionError(res.error ?? "Restore failed.");
    } catch {
      setBatchActionError("Restore failed.");
    } finally {
      setBatchActionLoading(false);
    }
  }
  async function batchUnarchive() {
    if (validSelectedIds.length === 0) return;
    setBatchActionError("");
    setBatchActionLoading(true);
    try {
      const res = await archiveCampaigns(validSelectedIds, false);
      if (res.success) {
        setSelectedCampaignIds(new Set());
        loadCampaignsList(campaignPage);
      } else setBatchActionError(res.error ?? "Unarchive failed.");
    } catch {
      setBatchActionError("Unarchive failed.");
    } finally {
      setBatchActionLoading(false);
    }
  }
  async function duplicateCampaignFromList(c: Campaign) {
    if (!c.id || userRole !== "SUPER_ADMIN") return;
    setPinError("");
    setDuplicatingCampaignId(c.id);
    try {
      const res = await insertCampaign({
        name: "Copy of " + (c.name ?? "Untitled"),
        organization_id: c.organization_id ?? "",
        required_fields: Array.isArray(c.required_fields) && c.required_fields.length > 0 ? c.required_fields : CAMPAIGN_REQUIRED_FIELDS,
        questions: Array.isArray(c.questions) && c.questions.length > 0 ? c.questions : null,
      });
      if (res.success) {
        onRefresh();
        loadCampaignsList(1);
        router.push("/campaigns/" + res.id);
      } else {
        setPinError(res.error ?? "Duplicate failed.");
      }
    } catch {
      setPinError("Duplicate failed.");
    } finally {
      setDuplicatingCampaignId(null);
    }
  }

  async function toggleCampaignPinned(c: Campaign) {
    if (!c.id) return;
    setPinError("");
    const next = !(c.pinned ?? false);
    try {
      const res = await updateCampaignPinned(c.id, next);
      if (!res.success) {
        setPinError(res.error ?? "Pin update failed.");
        return;
      }
      // Optimistic update so the star + "PINNED" pill update immediately (no refetch).
      setListRows((prev) => prev.map((row) => (row.id === c.id ? { ...row, pinned: next } : row)));
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Pin update failed.");
    }
  }

  return (
    <div className="mx-auto max-w-[98vw] space-y-10 px-4 py-8 font-sans">
      <section className="rounded-2xl border border-accent bg-muted p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {showArchivedCampaigns || (useServerList && showDeletedCampaigns) ? "All campaigns" : "Campaigns"}
            </h2>
            <p className="text-sm text-muted-foreground">View or manage campaigns.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {useServerList && (
              <input
                type="search"
                placeholder="Search name or id…"
                value={campaignSearchQuery}
                onChange={(e) => setCampaignSearchQuery(e.target.value)}
                className="h-9 w-72 max-w-full rounded border border-accent bg-background/50 px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                aria-label="Search campaigns"
              />
            )}
            {useServerList && (
              <label className="inline-flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                Status
                <select
                  value={campaignStatusFilter}
                  onChange={(e) => {
                    const v = e.target.value as "all" | "draft" | "active" | "inactive";
                    setCampaignStatusFilter(v);
                    setCampaignPage(1);
                  }}
                  className="h-7 rounded border border-accent bg-background/60 px-2 font-mono text-xs text-foreground outline-none"
                >
                  <option value="all">All</option>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            )}
            <label className="inline-flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2 text-xs text-muted-foreground">
              <input
                name="showArchivedCampaigns"
                aria-label="Show archived campaigns"
                type="checkbox"
                checked={showArchivedCampaigns}
                onChange={(e) => {
                  setShowArchivedCampaigns(e.target.checked);
                  if (useServerList) setCampaignPage(1);
                }}
                className="h-4 w-4 rounded border-accent"
              />
              Show archived
            </label>
            {useServerList && (
              <label className="inline-flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                <input
                  name="showDeletedCampaigns"
                  aria-label="Show deleted campaigns"
                  type="checkbox"
                  checked={showDeletedCampaigns}
                  onChange={(e) => {
                    setShowDeletedCampaigns(e.target.checked);
                    setCampaignPage(1);
                  }}
                  className="h-4 w-4 rounded border-accent"
                />
                Show deleted
              </label>
            )}
            {useServerList && (
              <>
                <button
                  type="button"
                  onClick={batchArchive}
                  disabled={batchActionLoading || validSelectedIds.length === 0}
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-mono text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {batchActionLoading ? "ARCHIVING..." : "ARCHIVE SELECTED"}
                </button>
                <button
                  type="button"
                  onClick={batchDelete}
                  disabled={batchActionLoading || validSelectedIds.length === 0}
                  className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-mono text-destructive hover:bg-destructive/20 disabled:opacity-50"
                >
                  {batchActionLoading ? "DELETING..." : "SOFT DELETE"}
                </button>
                {showDeletedCampaigns && (
                  <button
                    type="button"
                    onClick={batchRestore}
                    disabled={batchActionLoading || validSelectedIds.length === 0}
                    className="rounded border border-success/40 bg-success/10 px-3 py-2 text-xs font-mono text-success hover:bg-success/20 disabled:opacity-50"
                  >
                    {batchActionLoading ? "RESTORING..." : "RESTORE SELECTED"}
                  </button>
                )}
                {showArchivedCampaigns && (
                  <button
                    type="button"
                    onClick={batchUnarchive}
                    disabled={batchActionLoading || validSelectedIds.length === 0}
                    className="rounded border border-success/40 bg-success/10 px-3 py-2 text-xs font-mono text-success hover:bg-success/20 disabled:opacity-50"
                  >
                    {batchActionLoading ? "UNARCHIVING..." : "UNARCHIVE SELECTED"}
                  </button>
                )}
              </>
            )}
            {useServerList && (
              <button
                type="button"
                onClick={() => loadCampaignsList(campaignPage)}
                disabled={loadingCampaigns}
                className="rounded border border-accent bg-muted px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/60 disabled:opacity-50"
              >
                {loadingCampaigns ? "REFRESHING..." : "REFRESH DATABASE"}
              </button>
            )}
          </div>
        </div>

        {useServerList && (loadError || batchActionError || pinError) && (
          <div className="mb-4">
            {loadError && <p className="mb-2 text-sm text-destructive">{loadError}</p>}
            {batchActionError && <p className="mb-2 text-sm text-destructive">{batchActionError}</p>}
            {pinError && <p className="mb-2 text-sm text-destructive">{pinError}</p>}
            {loadError && (
              <button
                type="button"
                onClick={() => loadCampaignsList(campaignPage)}
                disabled={loadingCampaigns}
                className="rounded border border-accent bg-background px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/80 disabled:opacity-50"
              >
                RETRY
              </button>
            )}
          </div>
        )}

        {useServerList && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/60 bg-background/20 px-4 py-3">
            <div className="text-xs text-muted-foreground">
              {campaignTotal > 0 ? (
                <>
                  Showing{" "}
                  <span className="font-mono text-foreground">
                    {showingFrom}–{showingTo}
                  </span>{" "}
                  of <span className="font-mono text-foreground">{campaignTotal}</span>
                </>
              ) : (
                <>0 campaigns</>
              )}
              <span className="ml-3">
                Selected{" "}
                <span className="font-mono text-foreground">{validSelectedIds.length}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                Rows
                <select
                  value={campaignPageSize}
                  onChange={(e) => {
                    setCampaignPageSize(Number(e.target.value) || 50);
                    setCampaignPage(1);
                  }}
                  className="h-7 rounded border border-accent bg-background/60 px-2 font-mono text-xs text-foreground outline-none"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setCampaignPage((p) => {
                    const next = Math.max(1, Number(p) - 1);
                    return Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1;
                  });
                }}
                disabled={loadingCampaigns || effectivePage <= 1}
                className="ml-2 rounded border border-accent bg-background px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/80 disabled:opacity-50"
              >
                PREV
              </button>
              <div className="rounded border border-accent bg-background/40 px-3 py-2 text-xs font-mono text-muted-foreground">
                Page <span className="text-foreground">{effectivePage}</span> /{" "}
                <span className="text-foreground">{campaignPageCount}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCampaignPage((p) => {
                    const next = Math.min(campaignPageCount, Number(p) + 1);
                    return Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1;
                  });
                }}
                disabled={loadingCampaigns || effectivePage >= campaignPageCount}
                className="rounded border border-accent bg-background px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/80 disabled:opacity-50"
              >
                NEXT
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-accent/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-background/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">
                  {useServerList && displayCampaigns.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all campaigns on this page"
                      checked={
                        validDisplayIds.length > 0 &&
                        validDisplayIds.every((cid) => selectedCampaignIds.has(cid))
                      }
                      onChange={(e) => toggleAllCampaigns(e.target.checked)}
                      className="h-4 w-4 rounded border-accent"
                    />
                  )}
                </th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" title="Assets (tokens) assigned to this campaign in current scope">Assets</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Fields</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-accent/40">
              {displayCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-sm text-muted-foreground">
                    {useServerList && loadingCampaigns ? "Loading..." : "No campaigns yet."}
                  </td>
                </tr>
              ) : (
                displayCampaigns.map((c, i) => {
                  const campaignIdSafe =
                    typeof c.id === "string" && c.id.length > 0 && campaignIdUuidRegex.test(c.id);
                  const orgLabel =
                    organizations.length > 0
                      ? String(organizations.find((o) => o.id === c.organization_id)?.name ?? "—")
                      : "—";
                  const idShort =
                    typeof c.id === "string" && c.id.length >= 8 ? `${c.id.slice(0, 8)}…` : "—";
                  return (
                    <tr key={c.id ?? `campaign-${i}`} className="hover:bg-background/40">
                      <td className="px-4 py-3 align-top">
                        {useServerList && campaignIdSafe && c.id && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${String(c.name ?? "Campaign")}`}
                            checked={selectedCampaignIds.has(c.id)}
                            onChange={() => toggleCampaignSelection(c.id)}
                            className="h-4 w-4 rounded border-accent"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold">
                          <span className="inline-flex items-center gap-2">
                            {c.pinned && (
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                                PINNED
                              </span>
                            )}
                            {campaignIdSafe ? (
                              <Link
                                href={`/campaigns/${c.id}`}
                                className="hover:underline"
                              >
                                {String(c.name ?? "Untitled")}
                              </Link>
                            ) : (
                              <span>{String(c.name ?? "Untitled")}</span>
                            )}
                          </span>
                        </div>
                        <div className="mt-1">
                          <span className="rounded bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {orgLabel}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {useServerList && (c.status === "draft" || c.status === "active" || c.status === "inactive") ? (
                          <span
                            className={[
                              "rounded px-2 py-0.5 text-xs",
                              c.status === "active"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : c.status === "draft"
                                  ? "bg-blue-500/20 text-blue-400"
                                  : "bg-amber-500/20 text-amber-400",
                            ].join(" ")}
                          >
                            {c.status}
                          </span>
                        ) : !useServerList && (c as Campaign & { deleted_at?: string | null }).deleted_at ? (
                          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                            Archived
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {typeof tokenCountByCampaignId[c.id] === "number" ? (
                          <span className="font-mono text-muted-foreground">{tokenCountByCampaignId[c.id]}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
                        {idShort}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                        {requiredCount} required
                        {questionCount(c) > 0 ? ` + ${questionCount(c)} questions` : ""}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="flex items-center justify-end gap-2">
                          {useServerList && (
                            <button
                              type="button"
                              onClick={() => campaignIdSafe && c.id && toggleCampaignPinned(c)}
                              disabled={!campaignIdSafe || !c.id}
                              className="rounded border border-accent bg-background px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-background/80 disabled:opacity-50"
                              aria-label={c.pinned ? "Unpin campaign" : "Pin campaign"}
                              title={c.pinned ? "Unpin" : "Pin"}
                            >
                              {c.pinned ? "★" : "☆"}
                            </button>
                          )}
                          {useServerList && campaignIdSafe && c.id && (
                            <button
                              type="button"
                              onClick={() => duplicateCampaignFromList(c)}
                              disabled={!!duplicatingCampaignId}
                              className="rounded border border-accent bg-background px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-background/80 disabled:opacity-50"
                              aria-label="Duplicate campaign"
                              title="Duplicate"
                            >
                              {duplicatingCampaignId === c.id ? "…" : "Duplicate"}
                            </button>
                          )}
                          {campaignIdSafe ? (
                            <Link
                              href={`/campaigns/${c.id}`}
                              className="rounded border border-accent bg-background px-3 py-1 text-xs font-mono text-muted-foreground hover:bg-background/80"
                            >
                              VIEW
                            </Link>
                          ) : (
                            <span className="rounded border border-accent/40 bg-background/40 px-3 py-1 text-xs font-mono text-muted-foreground/70">
                              VIEW
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </section>

      {campaignsWrite && (
        <section className="rounded-2xl border border-accent bg-muted p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Create campaign
              </h2>
              <p className="text-sm text-muted-foreground">
                Draft a campaign. Required fields are collected for payout verification.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <fieldset className="space-y-6 lg:col-span-5">
              {userRole === "SUPER_ADMIN" && orgId === null && (
                <div className="space-y-2">
                  <label htmlFor="create-campaign-org" className="block text-sm text-muted-foreground">
                    Organization
                  </label>
                  <select
                    id="create-campaign-org"
                    name="createCampaignOrganization"
                    aria-label="Organization for new campaign"
                    value={createOrgId}
                    onChange={(e) => {
                      setCreateOrgId(e.target.value);
                      setCreateError("");
                    }}
                    className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Select organization...</option>
                    {organizations
                      .filter((o) => typeof o.id === "string" && o.id.length > 0)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {String(o.name ?? "")}
                        </option>
                      ))}
                  </select>
                  {organizations.length === 0 && (
                    <p className="text-xs text-amber-500">
                      No organizations found. Add the{" "}
                      <code className="rounded bg-muted px-1">organizations</code> table in Supabase (id,
                      name, slug), add RLS so you can read it, and insert at least one row. See{" "}
                      <code className="rounded bg-muted px-1">docs/ORGANIZATIONS_SETUP.md</code>.
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <label htmlFor="create-campaign-name" className="block text-sm text-muted-foreground">
                  Campaign name
                </label>
                <input
                  id="create-campaign-name"
                  name="createCampaignName"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`e.g. ${exampleCampaignName}`}
                  maxLength={500}
                  className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="rounded-lg border border-success/30 bg-background/20 p-3">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-success">
                  Required fields (reward payout)
                </h3>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  {CAMPAIGN_REQUIRED_FIELDS.map((f) => (
                    <li key={f.key} className="flex items-center gap-2">
                      <span className="text-success">✓</span>
                      {f.label}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Collected for every response; used for payouts.
                </p>
              </div>
            </fieldset>

            <div className="space-y-4 lg:col-span-7">
              <div className="flex items-start justify-between">
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  Additional questions (up to {MAX_QUESTIONS})
                  <span
                    className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-accent/60 bg-background/60 text-[10px] font-bold text-muted-foreground"
                    title="Optional. Leave blank to use only required fields."
                    aria-label="Optional. Leave blank to use only required fields."
                  >
                    ?
                  </span>
                </label>
                {questions.length < MAX_QUESTIONS && (
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="rounded border border-accent bg-background px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/80"
                  >
                    + Add
                  </button>
                )}
              </div>
              <div className="space-y-4">
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-3">
                    <input
                      id={`create-campaign-question-${i}`}
                      name={`createCampaignQuestion${i + 1}`}
                      aria-label={`Campaign question ${i + 1}`}
                      type="text"
                      value={q}
                      onChange={(e) => setQuestion(i, e.target.value)}
                      placeholder={exampleQuestions[i] ?? `Question ${i + 1}`}
                      className="h-10 flex-1 rounded border border-accent bg-background/50 px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeQuestion(i)}
                        className="h-10 w-10 shrink-0 rounded border border-destructive/40 bg-destructive/10 text-xs font-mono text-destructive hover:bg-destructive/20"
                        aria-label="Remove question"
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
          <div className="mt-8 flex justify-end border-t border-accent/40 pt-6">
            <button
              onClick={createCampaignSubmit}
              disabled={saving || !String(name ?? "").trim() || (orgId === null && !createOrgId)}
              className="rounded bg-primary px-6 py-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? "CREATING…" : "CREATE CAMPAIGN"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

const PERMISSION_LABELS: Record<string, string> = {
  fleet_write: "Fleet write (bulk assign campaign)",
  campaigns_write: "Campaigns write (create / edit)",
  map_reset: "Map reset (reset simulation)",
};

function SettingsTab({
  organizations,
  onRefreshOrganizations,
  rolePermissions,
  onRefresh,
  onTokensCreated,
}: {
  organizations: OrganizationWithType[];
  onRefreshOrganizations: () => void;
  rolePermissions: RolePermissionRow[];
  onRefresh: () => void;
  onTokensCreated?: () => void;
}) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgType, setOrgType] = useState<"school" | "institution">("institution");
  const [orgSubmitting, setOrgSubmitting] = useState(false);
  const [orgMessage, setOrgMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [orgToDelete, setOrgToDelete] = useState<OrganizationWithType | null>(null);
  const [orgDeleteSubmitting, setOrgDeleteSubmitting] = useState(false);
  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<string>("STUDENT");
  const [createOrgId, setCreateOrgId] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createMessage, setCreateMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [users, setUsers] = useState<ListUserRow[]>([]);
  const [editingUser, setEditingUser] = useState<ListUserRow | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editOrgId, setEditOrgId] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editMessage, setEditMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [resettingUser, setResettingUser] = useState<ListUserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [createTokensCount, setCreateTokensCount] = useState(1);
  const [createTokensSubmitting, setCreateTokensSubmitting] = useState(false);
  const [createdTokensList, setCreatedTokensList] = useState<{ id: string; claimUrl: string }[] | null>(null);
  const [createTokensError, setCreateTokensError] = useState<string | null>(null);
  const [removeFundsTokenId, setRemoveFundsTokenId] = useState("");
  const [removeFundsSubmitting, setRemoveFundsSubmitting] = useState(false);
  const [removeFundsMessage, setRemoveFundsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [redemptionNote, setRedemptionNote] = useState("");
  const [redemptionLink, setRedemptionLink] = useState("");
  const [redemptionLoading, setRedemptionLoading] = useState(true);
  const [redemptionSaving, setRedemptionSaving] = useState(false);
  const [redemptionMessage, setRedemptionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    listUsers().then(setUsers);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getRedemptionSuccessMessage().then((r) => {
      if (!cancelled) {
        setRedemptionNote(r.note ?? "");
        setRedemptionLink(r.link ?? "");
      }
      if (!cancelled) setRedemptionLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const refreshUsers = useCallback(() => {
    listUsers().then(setUsers);
  }, []);

  const openEdit = (u: ListUserRow) => {
    setEditingUser(u);
    setEditRole(u.role);
    setEditOrgId(u.organization_id ?? "");
    setEditFirstName(u.first_name ?? "");
    setEditLastName(u.last_name ?? "");
    setEditPhone(u.phone ?? "");
    setEditMessage(null);
  };
  const openReset = (u: ListUserRow) => {
    setResettingUser(u);
    setResetPassword("");
    setResetMessage(null);
  };
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditSubmitting(true);
    setEditMessage(null);
    const result = await updateUserRole(
      editingUser.id,
      editRole,
      editOrgId.trim() || null,
      {
        first_name: editFirstName.trim() || null,
        last_name: editLastName.trim() || null,
        phone: editPhone.trim() || null,
      }
    );
    setEditSubmitting(false);
    if (result.success) {
      setEditMessage({ type: "success", text: "User updated." });
      refreshUsers();
      setTimeout(() => { setEditingUser(null); setEditMessage(null); }, 1500);
    } else {
      setEditMessage({ type: "error", text: result.error });
    }
  };
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resettingUser) return;
    setResetSubmitting(true);
    setResetMessage(null);
    const result = await resetUserPassword(resettingUser.id, resetPassword);
    setResetSubmitting(false);
    if (result.success) {
      setResetMessage({ type: "success", text: "Password reset." });
      setResettingUser(null);
      setResetPassword("");
      setTimeout(() => setResetMessage(null), 2000);
    } else {
      setResetMessage({ type: "error", text: result.error });
    }
  };

  const handleCreateTokens = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateTokensSubmitting(true);
    setCreateTokensError(null);
    setCreatedTokensList(null);
    const result = await createTokens(createTokensCount);
    setCreateTokensSubmitting(false);
    if (result.success) {
      setCreatedTokensList(result.tokens);
      setCreateTokensError(null);
      onTokensCreated?.();
    } else {
      setCreateTokensError(result.error);
    }
  };

  const handleRemoveFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = removeFundsTokenId.trim();
    if (!id) {
      setRemoveFundsMessage({ type: "error", text: "Enter an asset ID (token UUID)." });
      return;
    }
    setRemoveFundsSubmitting(true);
    setRemoveFundsMessage(null);
    const result = await removeFundsFromToken(id);
    setRemoveFundsSubmitting(false);
    if (result.success) {
      setRemoveFundsMessage({
        type: "success",
        text: `Removed $${result.previous_balance} from token. Removed funds return to the bank account when connected.`,
      });
      setRemoveFundsTokenId("");
    } else {
      setRemoveFundsMessage({ type: "error", text: result.error ?? "Remove funds failed." });
    }
  };

  const handleSaveRedemption = async (e: React.FormEvent) => {
    e.preventDefault();
    setRedemptionSaving(true);
    setRedemptionMessage(null);
    const result = await setRedemptionSuccessMessage(redemptionNote, redemptionLink);
    setRedemptionSaving(false);
    if (result.success) {
      setRedemptionMessage({ type: "success", text: "Redemption message saved." });
      setTimeout(() => setRedemptionMessage(null), 3000);
    } else {
      setRedemptionMessage({ type: "error", text: result.error ?? "Save failed." });
    }
  };

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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSubmitting(true);
    setCreateMessage(null);
    const result = await createUserByEmail(
      createEmail.trim(),
      createPassword,
      createRole,
      createOrgId.trim() || undefined,
      {
        firstName: createFirstName.trim() || undefined,
        lastName: createLastName.trim() || undefined,
        phone: createPhone.trim() || undefined,
      }
    );
    setCreateSubmitting(false);
    if (result.success) {
      setCreateFirstName("");
      setCreateLastName("");
      setCreateEmail("");
      setCreatePhone("");
      setCreatePassword("");
      setCreateRole("STUDENT");
      setCreateOrgId("");
      setCreateMessage({ type: "success", text: "User created." });
      setTimeout(() => setCreateMessage(null), 3000);
      refreshUsers();
    } else {
      setCreateMessage({ type: "error", text: result.error });
    }
  };

  const showOrgDropdown = createRole === "ORG_ADMIN" || createRole === "STUDENT";

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrgSubmitting(true);
    setOrgMessage(null);
    const result = await createOrganization(
      orgName.trim(),
      orgSlug.trim() || null,
      orgType
    );
    setOrgSubmitting(false);
    if (result.success) {
      setOrgName("");
      setOrgSlug("");
      setOrgMessage({ type: "success", text: "Organization created." });
      setTimeout(() => setOrgMessage(null), 3000);
      onRefreshOrganizations();
    } else {
      setOrgMessage({ type: "error", text: result.error });
    }
  };

  const handleConfirmDeleteOrg = async () => {
    if (!orgToDelete) return;
    setOrgDeleteSubmitting(true);
    setOrgMessage(null);
    const result = await deleteOrganization(orgToDelete.id);
    setOrgDeleteSubmitting(false);
    setOrgToDelete(null);
    if (result.success) {
      setOrgMessage({ type: "success", text: "Organization removed." });
      setTimeout(() => setOrgMessage(null), 3000);
      onRefreshOrganizations();
    } else {
      setOrgMessage({ type: "error", text: result.error });
    }
  };

  return (
    <div className="mx-auto max-w-[98vw] px-4 py-8">
      {/* Redemption success message — shown below Venmo line on claim success */}
      <div className="mb-12 rounded-xl border border-accent bg-muted p-6">
        <h2 className="mb-2 text-xl font-bold">Redemption success message</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Optional note and link shown on the claim success page below &quot;Payout will be sent to your Venmo.&quot; (max 200 characters for note.)
        </p>
        {redemptionLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form onSubmit={handleSaveRedemption} className="space-y-4">
            <div>
              <label htmlFor="redemption-note" className="mb-1 block text-xs font-medium text-muted-foreground">
                Message (optional)
              </label>
              <textarea
                id="redemption-note"
                maxLength={200}
                rows={3}
                value={redemptionNote}
                onChange={(e) => setRedemptionNote(e.target.value.slice(0, 200))}
                className="w-full max-w-md rounded border border-accent bg-background px-3 py-2 text-sm"
                placeholder="e.g. Check your email for next steps."
              />
              <p className="mt-1 text-xs text-muted-foreground">{redemptionNote.length}/200</p>
            </div>
            <div>
              <label htmlFor="redemption-link" className="mb-1 block text-xs font-medium text-muted-foreground">
                Website link (optional)
              </label>
              <input
                id="redemption-link"
                type="url"
                value={redemptionLink}
                onChange={(e) => setRedemptionLink(e.target.value)}
                className="w-full max-w-md rounded border border-accent bg-background px-3 py-2 text-sm"
                placeholder="https://..."
              />
            </div>
            <button
              type="submit"
              disabled={redemptionSaving}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {redemptionSaving ? "Saving…" : "Save"}
            </button>
            {redemptionMessage && (
              <p className={redemptionMessage.type === "success" ? "text-sm text-success" : "text-sm text-destructive"}>
                {redemptionMessage.text}
              </p>
            )}
          </form>
        )}
      </div>

      {/* Token creation and remove funds — Settings (SuperAdmin) */}
      <div className="mb-12 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-6">
        <div>
          <h3 className="mb-2 text-sm font-bold text-emerald-400">Create new tokens</h3>
          <form onSubmit={handleCreateTokens} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Number to create</span>
              <input
                type="number"
                min={1}
                max={100}
                value={createTokensCount}
                onChange={(e) => setCreateTokensCount(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="w-24 rounded border border-accent bg-background px-3 py-2 text-sm font-mono"
              />
            </label>
            <button
              type="submit"
              disabled={createTokensSubmitting}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {createTokensSubmitting ? "Creating…" : "Create tokens"}
            </button>
          </form>
          {createTokensError && (
            <p className="mt-2 text-sm text-red-400">{createTokensError}</p>
          )}
          {createdTokensList && createdTokensList.length > 0 && (
            <div className="mt-4 rounded border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Program each NTAG with the URL below (one per token). Then assign campaign/org in Fleet.
              </p>
              <button
                type="button"
                onClick={() => {
                  const all = createdTokensList.map((t) => t.claimUrl).join("\n");
                  void navigator.clipboard.writeText(all);
                }}
                className="mb-3 rounded border border-accent px-2 py-1 text-xs hover:bg-muted"
              >
                Copy all URLs
              </button>
              <ul className="space-y-1.5 font-mono text-xs">
                {createdTokensList.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span className="truncate text-white">{t.claimUrl}</span>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(t.claimUrl)}
                      className="shrink-0 rounded border border-accent px-1.5 py-0.5 text-xs hover:bg-muted"
                    >
                      Copy
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-emerald-500/20 pt-6">
          <h3 className="mb-2 text-sm font-bold text-emerald-400">Remove funds from token</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Enter the asset ID (token UUID) to set that token&apos;s balance to $0. Removed funds (if not redeemed) return to the bank account when BENJI is connected. Only tokens with balance &gt; 0 can have funds removed.
          </p>
          <form onSubmit={handleRemoveFunds} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Asset ID (UUID)</span>
              <input
                type="text"
                value={removeFundsTokenId}
                onChange={(e) => { setRemoveFundsTokenId(e.target.value); setRemoveFundsMessage(null); }}
                placeholder="e.g. 189f08a3-9dfb-43d6-bfbb-7a69fdb514b3"
                className="w-80 max-w-full rounded border border-accent bg-background px-3 py-2 text-sm font-mono"
              />
            </label>
            <button
              type="submit"
              disabled={removeFundsSubmitting}
              className="rounded border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {removeFundsSubmitting ? "Removing…" : "Remove funds"}
            </button>
          </form>
          {removeFundsMessage && (
            <p className={`mt-2 text-sm ${removeFundsMessage.type === "success" ? "text-success" : "text-destructive"}`}>
              {removeFundsMessage.text}
            </p>
          )}
        </div>
      </div>

      <h2 className="mb-2 text-2xl font-bold">Create user</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Add a new user with first name, last name, email, phone, and password. Phone required for SuperAdmin/OrgAdmin. Choose role and assign an organization.
      </p>
      <form onSubmit={handleCreateUser} className="mb-10 rounded-xl border border-accent bg-muted p-6">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">First name</span>
            <input
              type="text"
              value={createFirstName}
              onChange={(e) => setCreateFirstName(e.target.value)}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
              placeholder="Andrew"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Last name</span>
            <input
              type="text"
              value={createLastName}
              onChange={(e) => setCreateLastName(e.target.value)}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
              placeholder="Brownlee"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
              placeholder="user@example.com"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Phone</span>
            <input
              type="tel"
              value={createPhone}
              onChange={(e) => setCreatePhone(e.target.value)}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
              placeholder="4192663760"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Password</span>
            <input
              type="password"
              required
              minLength={6}
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
              placeholder="Min 6 characters"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Role</span>
            <select
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value)}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {showOrgDropdown && (
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={createOrgId}
                onChange={(e) => setCreateOrgId(e.target.value)}
                className="rounded border border-accent bg-background px-3 py-2 text-sm"
              >
                <option value="">— None —</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={createSubmitting}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {createSubmitting ? "Creating…" : "Create user"}
            </button>
          </div>
        </div>
        {createMessage && (
          <p
            className={`mt-3 text-sm ${createMessage.type === "success" ? "text-success" : "text-destructive"}`}
          >
            {createMessage.text}
          </p>
        )}
      </form>

      <h2 className="mb-2 text-2xl font-bold">Users</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Existing app users (up to 100). Edit role/organization or reset password from row actions.
      </p>

      {editingUser && (
        <form onSubmit={handleSaveEdit} className="mb-4 rounded-xl border border-accent bg-muted p-4">
          <h3 className="mb-3 text-sm font-bold">Edit user: {editingUser.email}</h3>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">First name</span>
              <input
                type="text"
                value={editFirstName}
                onChange={(e) => setEditFirstName(e.target.value)}
                className="rounded border border-accent bg-background px-3 py-2 text-sm"
                placeholder="Andrew"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Last name</span>
              <input
                type="text"
                value={editLastName}
                onChange={(e) => setEditLastName(e.target.value)}
                className="rounded border border-accent bg-background px-3 py-2 text-sm"
                placeholder="Brownlee"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Phone</span>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="rounded border border-accent bg-background px-3 py-2 text-sm"
                placeholder="4192663760"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Role</span>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="rounded border border-accent bg-background px-3 py-2 text-sm"
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Organization</span>
              <select
                value={editOrgId}
                onChange={(e) => setEditOrgId(e.target.value)}
                className="rounded border border-accent bg-background px-3 py-2 text-sm"
              >
                <option value="">— None —</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={editSubmitting} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {editSubmitting ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => { setEditingUser(null); setEditMessage(null); }} className="rounded border border-accent px-3 py-2 text-sm hover:bg-muted">
              Cancel
            </button>
          </div>
          {editMessage && (
            <p className={`mt-2 text-sm ${editMessage.type === "success" ? "text-success" : "text-destructive"}`}>
              {editMessage.text}
            </p>
          )}
        </form>
      )}

      {resettingUser && (
        <form onSubmit={handleResetPassword} className="mb-4 rounded-xl border border-accent bg-muted p-4">
          <h3 className="mb-3 text-sm font-bold">Reset password: {resettingUser.email}</h3>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">New password</span>
              <input
                type="password"
                required
                minLength={6}
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="rounded border border-accent bg-background px-3 py-2 text-sm"
                placeholder="Min 6 characters"
              />
            </label>
            <button type="submit" disabled={resetSubmitting} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {resetSubmitting ? "Resetting…" : "Reset password"}
            </button>
            <button type="button" onClick={() => { setResettingUser(null); setResetMessage(null); }} className="rounded border border-accent px-3 py-2 text-sm hover:bg-muted">
              Cancel
            </button>
          </div>
          {resetMessage && (
            <p className={`mt-2 text-sm ${resetMessage.type === "success" ? "text-success" : "text-destructive"}`}>
              {resetMessage.text}
            </p>
          )}
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-accent bg-muted">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr className="border-b border-accent">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">Organization</th>
              <th className="p-3 font-medium">Last sign-in</th>
              <th className="p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-muted-foreground">
                  No users yet.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-b border-accent last:border-0">
                <td className="p-3">
                  {u.first_name?.trim() && u.last_name?.trim()
                    ? `${u.first_name.trim()} ${u.last_name.trim()}`
                    : u.email}
                </td>
                <td className="p-3">{u.email}</td>
                <td className="p-3 font-mono text-xs uppercase">{u.role}</td>
                <td className="p-3">{u.organization_name ?? "—"}</td>
                <td className="p-3 text-sm text-muted-foreground">
                  {u.last_sign_in_at
                    ? new Date(u.last_sign_in_at).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "Never"}
                </td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="rounded border border-accent px-2 py-1 text-xs hover:bg-muted"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => openReset(u)}
                      className="rounded border border-accent px-2 py-1 text-xs hover:bg-muted"
                    >
                      Reset password
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-12 text-2xl font-bold">Organizations</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Add schools or institutions. Schools appear in Fleet and Campaigns; institutions appear only in user assignment.
      </p>
      <form onSubmit={handleCreateOrganization} className="mb-6 rounded-xl border border-accent bg-muted p-6">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Name</span>
            <input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
              placeholder="e.g. Offbeat Options"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Slug (optional)</span>
            <input
              type="text"
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
              placeholder="e.g. offbeat-options"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Type</span>
            <select
              value={orgType}
              onChange={(e) => setOrgType(e.target.value as "school" | "institution")}
              className="rounded border border-accent bg-background px-3 py-2 text-sm"
            >
              <option value="school">School</option>
              <option value="institution">Institution</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={orgSubmitting}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {orgSubmitting ? "Adding…" : "Add organization"}
            </button>
          </div>
        </div>
        {orgMessage && (
          <p className={`mt-3 text-sm ${orgMessage.type === "success" ? "text-success" : "text-destructive"}`}>
            {orgMessage.text}
          </p>
        )}
      </form>
      {orgToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-org-title"
        >
          <div className="w-full max-w-md rounded-xl border border-accent bg-background p-6 shadow-lg">
            <h3 id="delete-org-title" className="mb-2 text-lg font-bold text-destructive">
              Remove organization?
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              <strong className="text-foreground">{orgToDelete.name}</strong> will be permanently removed. This cannot be undone.
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Deletion is only allowed if the organization has no tokens, campaigns, or users assigned. If any are linked, you will see an error and the organization will not be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOrgToDelete(null)}
                disabled={orgDeleteSubmitting}
                className="rounded border border-accent px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteOrg}
                disabled={orgDeleteSubmitting}
                className="rounded bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
              >
                {orgDeleteSubmitting ? "Removing…" : "Remove organization"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-10 overflow-x-auto rounded-xl border border-accent bg-muted">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr className="border-b border-accent">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Slug</th>
              <th className="p-3 font-medium">Type</th>
              <th className="p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-muted-foreground">
                  No organizations yet. Add one above.
                </td>
              </tr>
            )}
            {organizations.map((o) => (
              <tr key={o.id} className="border-b border-accent last:border-0">
                <td className="p-3">{o.name}</td>
                <td className="p-3 font-mono text-xs">{o.slug ?? "—"}</td>
                <td className="p-3">{o.type}</td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => setOrgToDelete(o)}
                    className="rounded border border-destructive/50 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-2xl font-bold">Role permissions</h2>
      <p className="mb-2 text-sm text-muted-foreground">
        Your role (SUPER_ADMIN) has full access to all features. The toggles below control write access for ORG_ADMIN and AUDITOR only. STUDENT has no Command Center write access.
      </p>
      <p className="mb-2 text-sm text-muted-foreground">
        All org roles can view fleet, campaigns, and map; these toggles determine who can change data (bulk assign, create/edit campaigns, reset map).
      </p>
      <ul className="mb-6 list-inside list-disc text-sm text-muted-foreground">
        <li><strong>Fleet write</strong> — bulk assign tokens to a school / campaign</li>
        <li><strong>Campaigns write</strong> — create, edit, archive, pin campaigns</li>
        <li><strong>Map reset</strong> — reset simulation (tokens back to active)</li>
      </ul>
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
                      name={`rolePermission_${id}`}
                      aria-label={`Toggle permission ${PERMISSION_LABELS[key] ?? key} for role ${role}`}
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

// Reserved for future pricing/deal-scenario UI; may be wired in settings/tabs later
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved component
function PricingTab({ supabase: _supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [name, setName] = useState("");
  const [targetStudents, setTargetStudents] = useState(1000);
  const [redemptionVelocity, setRedemptionVelocity] = useState(0.5);
  const [assumedYieldRate, setAssumedYieldRate] = useState(3.0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [scenarios, setScenarios] = useState<DealScenario[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState(false);
  const [scenarioTotal, setScenarioTotal] = useState(0);
  const [scenarioPage, setScenarioPage] = useState(1);
  const scenarioPageSize = 12;

  // Calculate TDV and value-led KPIs in real-time
  const tdv = calculateTDV(targetStudents, redemptionVelocity, assumedYieldRate);
  const distributions = calculateDistributions(tdv, assumedYieldRate);
  const valueKPIs = calculateValueKPIs(tdv, assumedYieldRate);
  const scenarioPageCount = Math.max(1, Math.ceil(scenarioTotal / scenarioPageSize));

  async function loadScenariosPage(page: number) {
    setLoadingScenarios(true);
    try {
      const res = await listDealScenarios<DealScenario>({
        page,
        pageSize: scenarioPageSize,
        showArchived: false,
        showDeleted: false,
      });
      if (!res.success) {
        console.error("[Pricing] Error loading scenarios:", res.error);
        setScenarios([]);
        setScenarioTotal(0);
        return;
      }
      setScenarios(res.rows ?? []);
      setScenarioTotal(res.total ?? 0);
    } finally {
      setLoadingScenarios(false);
    }
  }

  // Load saved scenarios (paged)
  useEffect(() => {
    loadScenariosPage(scenarioPage);
  }, [scenarioPage]);

  async function handleSave() {
    if (!name.trim()) {
      setSaveError("Please enter a deal name.");
      return;
    }
    setSaveError("");
    setSaving(true);

    const insertRes = await insertDealScenario({
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
    if (!insertRes.success) {
      setSaveError(insertRes.error);
    } else {
      setName("");
      setTargetStudents(1000);
      setRedemptionVelocity(0.5);
      setAssumedYieldRate(3.0);
      // Reload scenarios (return to page 1)
      setScenarioPage(1);
      await loadScenariosPage(1);
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
                <label htmlFor="pricing-deal-name" className="mb-1 block text-sm text-muted-foreground">
                  Institution / Opportunity Name
                </label>
                <input
                  id="pricing-deal-name"
                  name="pricingDealName"
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
                <label htmlFor="pricing-target-students" className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
                  Campus Impact Scale (S)
                  <span
                    className="cursor-help text-xs text-slate-500"
                    title="Number of students eligible for the pilot"
                  >
                    ⓘ
                  </span>
                </label>
                <input
                  id="pricing-target-students"
                  name="pricingTargetStudents"
                  type="number"
                  value={targetStudents}
                  onChange={(e) => setTargetStudents(Number(e.target.value) || 0)}
                  min="1"
                  step="1"
                  className="h-10 w-full rounded border border-border bg-black/20 px-3 text-sm font-mono focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label htmlFor="pricing-redemption-velocity" className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
                  Utilization Intensity (R<sub>pm</sub>)
                  <span
                    className="cursor-help text-xs text-slate-500"
                    title="Projected tokens redeemed per student per month"
                  >
                    ⓘ
                  </span>
                </label>
                <input
                  id="pricing-redemption-velocity"
                  name="pricingRedemptionVelocity"
                  type="number"
                  value={redemptionVelocity}
                  onChange={(e) => setRedemptionVelocity(Number(e.target.value) || 0)}
                  min="0"
                  step="0.1"
                  className="h-10 w-full rounded border border-border bg-black/20 px-3 text-sm font-mono focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label htmlFor="pricing-assumed-yield-rate" className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
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
                    id="pricing-assumed-yield-rate"
                    name="pricingAssumedYieldRate"
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
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-4 py-3">
              <div className="text-xs text-muted-foreground">
                Page <span className="font-mono text-white">{scenarioPage}</span> /{" "}
                <span className="font-mono text-white">{scenarioPageCount}</span>{" "}
                <span className="ml-2 font-mono">
                  ({scenarioTotal.toLocaleString("en-US")} total)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScenarioPage((p) => Math.max(1, p - 1))}
                  disabled={scenarioPage <= 1}
                  className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-white/5 disabled:opacity-50"
                >
                  PREV
                </button>
                <button
                  type="button"
                  onClick={() => setScenarioPage((p) => Math.min(scenarioPageCount, p + 1))}
                  disabled={scenarioPage >= scenarioPageCount}
                  className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-white/5 disabled:opacity-50"
                >
                  NEXT
                </button>
              </div>
            </div>
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
          </>
        )}
      </div>
    </div>
  );
}
