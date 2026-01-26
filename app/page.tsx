"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import MapView from "@/components/map-view";
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
      campaign_id: (r.campaign_id as string) ?? null,
      campaigns: (r.campaigns as { name: string } | null) ?? null,
    };
  });
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tokens, setTokens] = useState<TokenWithCampaign[]>([]);
  const [responsesCount, setResponsesCount] = useState<number>(0);
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(new Set());
  const [targetCampaignId, setTargetCampaignId] = useState("");

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: cData } = await supabase
      .from("campaigns")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setCampaigns((cData as Campaign[]) ?? []);

    // Load tokens: try with campaign join first; fall back to tokens-only if join fails
    const { data: tData, error } = await supabase
      .from("tokens")
      .select("*, campaigns(name)")
      .order("id");
    if (!error && tData) {
      setTokens(normalizeTokensWithCampaign(tData));
    } else {
      if (error) {
        console.warn("Fleet join failed, loading tokens only:", error.message);
      }
      const { data: tokensOnly } = await supabase
        .from("tokens")
        .select("*")
        .order("id");
      setTokens(normalizeTokensWithCampaign(tokensOnly ?? []));
    }

    // Responses count: all rows (persists even when campaigns are archived)
    const { count } = await supabase
      .from("responses")
      .select("*", { count: "exact", head: true });
    setResponsesCount(count ?? 0);
  }

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

  return (
    <div className="min-h-screen bg-black text-white">
      <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-8 py-4">
        <h1 className="text-xl font-bold tracking-tighter text-blue-500">
          OFFBEAT COMMAND
        </h1>
        <div className="flex rounded-lg border border-gray-800 bg-black p-1">
          <button
            onClick={() => {
              setActiveTab("map");
              loadData();
            }}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "map" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
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
              activeTab === "fleet" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            FLEET
          </button>
          <button
            onClick={() => setActiveTab("campaigns")}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "campaigns" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            CAMPAIGNS
          </button>
        </div>
        <div className="w-32 text-right font-mono text-xs uppercase text-gray-500">
          Ver 2.0.1
        </div>
      </nav>

      <main className="p-0">
        <ProjectStats
          tokenCount={tokens.length}
          foundCount={tokens.filter((t) => t.status === "found").length}
          responsesCount={responsesCount}
        />
        {activeTab === "map" && (
          <div className="h-[calc(100vh-72px-8rem)] w-full">
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
          />
        )}

        {activeTab === "campaigns" && (
          <CampaignsTab campaigns={campaigns} onRefresh={loadData} supabase={supabase} />
        )}
      </main>
    </div>
  );
}

const PAYOUT_PER_RESPONSE = 25;

function ProjectStats({
  tokenCount,
  foundCount,
  responsesCount,
}: {
  tokenCount: number;
  foundCount: number;
  responsesCount: number;
}) {
  const progress = tokenCount > 0 ? (foundCount / tokenCount) * 100 : 0;
  const totalPayout = responsesCount * PAYOUT_PER_RESPONSE;

  return (
    <div className="grid grid-cols-1 gap-4 border-b border-white/5 bg-black/40 px-6 py-4 md:grid-cols-3">
      <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Fleet Status
        </h3>
        <p className="mb-2 font-mono text-xl font-bold text-white">
          {foundCount} / {tokenCount}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>
      <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Research Participation
        </h3>
        <p className="font-mono text-xl font-bold text-white">
          {responsesCount.toLocaleString()} submission{responsesCount !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-4 backdrop-blur-sm">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Payout Liability
        </h3>
        <p className="font-mono text-xl font-bold tabular-nums text-green-500">
          ${totalPayout.toLocaleString("en-US", { minimumFractionDigits: 2 })}
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
}: {
  tokens: TokenWithCampaign[];
  campaigns: Campaign[];
  selectedTokenIds: Set<string>;
  setSelectedTokenIds: (s: Set<string>) => void;
  targetCampaignId: string;
  setTargetCampaignId: (id: string) => void;
  onAssign: () => void;
  onRefresh: () => void;
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
            className="rounded border border-gray-700 bg-gray-900 p-2 text-sm"
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
            className="rounded bg-blue-600 px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            BULK ASSIGN
          </button>
          <button
            onClick={onRefresh}
            className="rounded border border-gray-700 px-4 py-2 text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      <table className="w-full border-collapse text-left">
        <thead className="border-b border-gray-800 text-xs uppercase text-gray-500">
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
        <tbody className="divide-y divide-gray-900 text-sm">
          {tokens.map((t) => (
            <tr key={t.id} className="hover:bg-gray-900/50">
              <td className="p-4">
                <input
                  type="checkbox"
                  checked={selectedTokenIds.has(t.id)}
                  onChange={() => toggleOne(t.id)}
                />
              </td>
              <td className="font-mono p-4">...{t.id.slice(-8)}</td>
              <td className="p-4 text-gray-400">
                {t.lat.toFixed(4)}, {t.lng.toFixed(4)}
              </td>
              <td className="p-4 font-bold text-emerald-400">
                {t.campaigns?.name ?? "Unassigned"}
              </td>
              <td className="p-4 text-right">
                <span className="rounded bg-gray-800 px-2 py-1 font-bold text-[10px] uppercase">
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
}: {
  campaigns: Campaign[];
  onRefresh: () => void;
  supabase: ReturnType<typeof createClient>;
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
      <div className="h-fit rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-xl font-bold">Create Campaign</h2>
        <div className="space-y-4">
          {/* Required fields – fixed for reward payout */}
          <div className="rounded-lg border border-emerald-500/30 bg-black/40 p-3">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
              Required fields (reward payout)
            </h3>
            <ul className="space-y-1.5 text-sm text-zinc-300">
              {CAMPAIGN_REQUIRED_FIELDS.map((f) => (
                <li key={f.key} className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span>
                  {f.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-zinc-500">
              Collected for every response; used for payouts.
            </p>
          </div>

          <label className="block text-sm text-gray-400">Campaign name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Austin Q1 Survey"
            className="w-full rounded border border-gray-700 bg-black px-3 py-2 text-sm"
          />

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-400">
              Additional questions (up to {MAX_QUESTIONS})
            </label>
            {questions.length < MAX_QUESTIONS && (
              <button
                type="button"
                onClick={addQuestion}
                className="text-xs text-blue-400 hover:underline"
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
                className="flex-1 rounded border border-gray-700 bg-black px-3 py-2 text-sm"
              />
              {questions.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeQuestion(i)}
                  className="text-red-400 hover:underline"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            onClick={createCampaign}
            disabled={saving || !name.trim()}
            className="w-full rounded bg-blue-600 py-2 font-bold disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Campaign"}
          </button>
        </div>
      </div>

      <div className="space-y-4 md:col-span-2">
        <h2 className="text-xl font-bold">Active Surveys</h2>
        {campaigns.length === 0 && (
          <p className="text-sm italic text-gray-500">No campaigns yet.</p>
        )}
        {campaigns.map((c) => (
          <Link
            key={c.id}
            href={`/campaigns/${c.id}`}
            className="flex justify-between rounded-lg border border-gray-800 bg-gray-900 p-4 transition hover:border-gray-700 hover:bg-gray-800/50"
          >
            <div>
              <span className="font-bold">{c.name}</span>
              <p className="font-mono text-xs text-gray-500">{c.id}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {requiredCount} required fields
                {questionCount(c) > 0 && ` + ${questionCount(c)} questions`}
              </p>
            </div>
            <div className="text-right text-sm font-bold text-blue-400">
              {questionCount(c)} custom →
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
