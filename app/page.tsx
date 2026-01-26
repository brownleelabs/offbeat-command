"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import MapView from "@/components/map-view";
import { useDashboard, type ViewMode } from "@/components/dashboard-context";
import type { Campaign, TokenWithCampaign } from "@/types";
import type { CampaignQuestion } from "@/types";
import { CAMPAIGN_REQUIRED_FIELDS } from "@/types";

type Tab = "map" | "fleet" | "campaigns";

const MAX_QUESTIONS = 10;

/** Normalize raw token rows so Fleet tab always has TokenWithCampaign shape (lat/lng, campaigns). */
function normalizeTokensWithCampaign(rows: unknown[]): TokenWithCampaign[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const lat = (r.lat as number) ?? (r.latitude as number) ?? 0;
    const lng = (r.lng as number) ?? (r.longitude as number) ?? 0;
    return {
      id: String(r.id),
      lat: Number(lat),
      lng: Number(lng),
      status: (r.status === "found" ? "found" : "active") as "active" | "found",
      organization_id: (r.organization_id as string) ?? null,
      campaign_id: (r.campaign_id as string) ?? null,
      campaigns: (r.campaigns as { name: string } | null) ?? null,
    };
  });
}

const ADMIN_ROLES = ["SUPER_ADMIN", "ORG_ADMIN", "AUDITOR"] as const;
function isAdminRole(role: string | undefined): role is (typeof ADMIN_ROLES)[number] {
  return role != null && (ADMIN_ROLES as readonly string[]).includes(role);
}

export default function AdminDashboard() {
  const { viewMode, toggleViewMode, userRole, orgId, loading, profile, authError } = useDashboard();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tokens, setTokens] = useState<TokenWithCampaign[]>([]);
  const [responsesCount, setResponsesCount] = useState<number>(0);
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(new Set());
  const [targetCampaignId, setTargetCampaignId] = useState("");

  const supabase = createClient();

  // Fetch organization name when we have orgId and need it for display (STUDENT or ORG_ADMIN/AUDITOR)
  useEffect(() => {
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
    let campaignsQuery = supabase
      .from("campaigns")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (orgId != null) {
      campaignsQuery = campaignsQuery.eq("organization_id", orgId);
    }
    const { data: cData } = await campaignsQuery;
    setCampaigns((cData as Campaign[]) ?? []);

    let tokensQuery = supabase
      .from("tokens")
      .select("*, campaigns(name)")
      .order("id");
    if (orgId != null) {
      tokensQuery = tokensQuery.eq("organization_id", orgId);
    }
    const { data: tData, error } = await tokensQuery;
    if (!error && tData) {
      setTokens(normalizeTokensWithCampaign(tData));
    } else {
      if (error) {
        console.warn("Fleet join failed, loading tokens only:", error.message);
      }
      let tokensOnlyQuery = supabase.from("tokens").select("*").order("id");
      if (orgId != null) {
        tokensOnlyQuery = tokensOnlyQuery.eq("organization_id", orgId);
      }
      const { data: tokensOnly } = await tokensOnlyQuery;
      setTokens(normalizeTokensWithCampaign(tokensOnly ?? []));
    }

    let responsesQuery = supabase
      .from("responses")
      .select("*", { count: "exact", head: true });
    if (orgId != null) {
      responsesQuery = responsesQuery.eq("organization_id", orgId);
    }
    const { count } = await responsesQuery;
    setResponsesCount(count ?? 0);
  }, [orgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function assignTokens() {
    if (!targetCampaignId || selectedTokenIds.size === 0) return;
    const { error } = await supabase
      .from("tokens")
      .update({ campaign_id: targetCampaignId })
      .in("id", Array.from(selectedTokenIds));
    if (!error) {
      setSelectedTokenIds(new Set());
      loadData();
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
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-zinc-950 px-4 text-center text-white">
        {isSessionMissing ? (
          <>
            <h1 className="text-xl font-bold text-red-500">AUTH SESSION MISSING</h1>
            <p className="max-w-md text-zinc-400">
              Your browser or an extension (e.g. MetaMask, Lockdown) may be blocking
              the auth session. Try: open this site in a private/incognito window, or
              disable that extension for this site, then sign in again.
            </p>
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
          OFFBEAT COMMAND
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
        <ExecutiveStats
          viewMode={viewMode}
          tokens={tokens}
          responsesCount={responsesCount}
        />
        {activeTab === "map" && (
          <div className="h-[calc(100vh-72px-8rem)] min-h-[420px] w-full">
            <MapView />
          </div>
        )}

        {activeTab === "fleet" && (
          <FleetTab
            tokens={tokens}
            campaigns={campaigns}
            selectedTokenIds={selectedTokenIds}
            setSelectedTokenIds={setSelectedTokenIds}
            targetCampaignId={targetCampaignId}
            setTargetCampaignId={setTargetCampaignId}
            onAssign={assignTokens}
            onRefresh={loadData}
            orgId={orgId}
          />
        )}

        {activeTab === "campaigns" && (
          <CampaignsTab
            campaigns={campaigns}
            onRefresh={loadData}
            supabase={supabase}
            orgId={orgId}
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

  if (viewMode === "GLOBAL") {
    return (
      <div className="grid grid-cols-1 gap-4 border-b border-accent bg-background/95 px-6 py-4 md:grid-cols-3">
        <div className="rounded-xl border border-accent bg-muted p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Global AUM
          </h3>
          <p className="font-mono text-xl font-bold text-foreground">$1.2M</p>
        </div>
        <div className="rounded-xl border border-accent bg-muted p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Net Treasury Yield
          </h3>
          <p className="font-mono text-xl font-bold tabular-nums text-success">
            +$4,250
          </p>
        </div>
        <div className="rounded-xl border border-accent bg-muted p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Active Campuses
          </h3>
          <p className="font-mono text-xl font-bold text-primary">12</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 border-b border-accent bg-background/95 px-6 py-4 md:grid-cols-3">
      <div className="rounded-xl border border-accent bg-muted p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Campus Liquidity
        </h3>
        <p className="font-mono text-xl font-bold text-foreground">
          ${campusLiquidity.toLocaleString("en-US")}
        </p>
      </div>
      <div className="rounded-xl border border-accent bg-muted p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Yield Earned
        </h3>
        <p className="font-mono text-xl font-bold tabular-nums text-success">
          +${yieldEarned.toLocaleString("en-US")} (4.5% APY)
        </p>
      </div>
      <div className="rounded-xl border border-accent bg-muted p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Active Fleet
        </h3>
        <p className="font-mono text-xl font-bold text-primary">
          {activeCount}
        </p>
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

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">Fleet Management</h2>
        <div className="flex gap-4">
          <select
            value={targetCampaignId}
            onChange={(e) => setTargetCampaignId(e.target.value)}
            className="rounded border border-accent bg-muted p-2 text-sm"
          >
            <option value="">Select Campaign to Assign...</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={onAssign}
            disabled={!targetCampaignId || selectedTokenIds.size === 0}
            className="rounded bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            BULK ASSIGN
          </button>
          <button
            onClick={onRefresh}
            className="rounded border border-accent px-4 py-2 text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      <table className="w-full border-collapse text-left">
        <thead className="border-b border-accent text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-4">
              <input
                type="checkbox"
                checked={tokens.length > 0 && selectedTokenIds.size === tokens.length}
                onChange={(e) => toggleAll(e.target.checked)}
              />
            </th>
            <th className="p-4">Asset ID</th>
            <th className="p-4">Coordinates</th>
            <th className="p-4">Active Campaign</th>
            <th className="p-4 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-accent text-sm">
          {tokens.map((t) => (
            <tr key={t.id} className="hover:bg-muted/50">
              <td className="p-4">
                <input
                  type="checkbox"
                  checked={selectedTokenIds.has(t.id)}
                  onChange={() => toggleOne(t.id)}
                />
              </td>
              <td className="font-mono p-4">...{t.id.slice(-8)}</td>
              <td className="p-4 text-muted-foreground">
                {t.lat.toFixed(4)}, {t.lng.toFixed(4)}
              </td>
              <td className="p-4 font-bold text-success">
                {t.campaigns?.name ?? "Unassigned"}
              </td>
              <td className="p-4 text-right">
                <span className="rounded bg-muted px-2 py-1 font-bold text-[10px] uppercase">
                  {t.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignsTab({
  campaigns,
  onRefresh,
  supabase,
  orgId,
}: {
  campaigns: Campaign[];
  onRefresh: () => void;
  supabase: ReturnType<typeof createClient>;
  orgId: string | null;
}) {
  const [name, setName] = useState("");
  const [questions, setQuestions] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);

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
    const qs: CampaignQuestion[] = questions
      .map((text, order) => ({ order: order + 1, text: text.trim() }))
      .filter((q) => q.text.length > 0);
    setSaving(true);
    const { error } = await supabase.from("campaigns").insert({
      name: trimmedName,
      required_fields: CAMPAIGN_REQUIRED_FIELDS,
      questions: qs.length ? qs : null,
      organization_id: orgId,
    });
    setSaving(false);
    if (!error) {
      setName("");
      setQuestions([""]);
      onRefresh();
    }
  }

  const questionCount = (c: Campaign) =>
    Array.isArray(c.questions) ? c.questions.length : 0;
  const requiredCount = CAMPAIGN_REQUIRED_FIELDS.length;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 p-8 md:grid-cols-3">
      <div className="h-fit rounded-xl border border-accent bg-muted p-6">
        <h2 className="mb-4 text-xl font-bold">Create Campaign</h2>
        <div className="space-y-4">
          {/* Required fields – fixed for reward payout */}
          <div className="rounded-lg border border-success/30 bg-background/95 p-3">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-success">
              Required fields (reward payout)
            </h3>
            <ul className="space-y-1.5 text-sm text-accent">
              {CAMPAIGN_REQUIRED_FIELDS.map((f) => (
                <li key={f.key} className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  {f.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Collected for every response; used for payouts.
            </p>
          </div>

          <label className="block text-sm text-muted-foreground">Campaign name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Austin Q1 Survey"
            className="w-full rounded border border-accent bg-background px-3 py-2 text-sm"
          />

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
          {questions.map((q, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={q}
                onChange={(e) => setQuestion(i, e.target.value)}
                placeholder={`Question ${i + 1}`}
                className="flex-1 rounded border border-accent bg-background px-3 py-2 text-sm"
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
          <button
            onClick={createCampaign}
            disabled={saving || !name.trim()}
            className="w-full rounded bg-primary py-2 font-bold text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Campaign"}
          </button>
        </div>
      </div>

      <div className="space-y-4 md:col-span-2">
        <h2 className="text-xl font-bold">Active Surveys</h2>
        {campaigns.length === 0 && (
          <p className="text-sm italic text-muted-foreground">No campaigns yet.</p>
        )}
        {campaigns.map((c) => (
          <Link
            key={c.id}
            href={`/campaigns/${c.id}`}
            className="flex justify-between rounded-lg border border-accent bg-muted p-4 transition hover:bg-muted/80"
          >
            <div>
              <span className="font-bold">{c.name}</span>
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
