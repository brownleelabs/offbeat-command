"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import MapView from "@/components/map-view";
import type { Campaign, TokenWithCampaign } from "@/types";
import type { CampaignQuestion } from "@/types";

type Tab = "map" | "fleet" | "campaigns";

const MAX_QUESTIONS = 10;

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tokens, setTokens] = useState<TokenWithCampaign[]>([]);
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
      .order("created_at", { ascending: false });
    setCampaigns((cData as Campaign[]) ?? []);

    // Relational join: tokens.campaign_id → campaigns.id; returns campaigns: { name }
    const { data: tData, error } = await supabase
      .from("tokens")
      .select("*, campaigns(name)")
      .order("id");
    if (error) {
      console.error("Fleet load error:", error);
      return;
    }
    setTokens((tData as TokenWithCampaign[]) ?? []);
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
            onClick={() => setActiveTab("map")}
            className={`rounded-md px-6 py-2 transition ${
              activeTab === "map" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            MAP
          </button>
          <button
            onClick={() => setActiveTab("fleet")}
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
        {activeTab === "map" && (
          <div className="h-[calc(100vh-72px)] w-full">
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
            disabled={selectedTokenIds.size === 0}
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

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 p-8 md:grid-cols-3">
      <div className="h-fit rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-xl font-bold">Create Campaign</h2>
        <div className="space-y-4">
          <label className="block text-sm text-gray-400">Campaign name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Austin Q1 Survey"
            className="w-full rounded border border-gray-700 bg-black px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-400">Questions (up to {MAX_QUESTIONS})</label>
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
          <div
            key={c.id}
            className="flex justify-between rounded-lg border border-gray-800 bg-gray-900 p-4"
          >
            <div>
              <span className="font-bold">{c.name}</span>
              <p className="font-mono text-xs text-gray-500">{c.id}</p>
            </div>
            <div className="text-sm font-bold text-blue-400">
              {questionCount(c)} Questions
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
