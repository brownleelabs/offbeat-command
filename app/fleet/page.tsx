"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type CampaignRow = { id: string; name: string };
type TokenRow = Record<string, unknown> & {
  id: string;
  campaigns?: { name: string } | null;
};

export default function FleetPage() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(new Set());
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function loadCampaigns() {
    const supabase = createClient();
    const { data } = await supabase
      .from("campaigns")
      .select("id, name")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setCampaigns((data as CampaignRow[]) ?? []);
  }

  async function loadFleet() {
    setLoading(true);
    setError(null);
    setAssignMessage(null);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("tokens")
        .select("*, campaigns(name)")
        .order("id", { ascending: true });
      if (err) {
        setError(err.message);
        setTokens([]);
        return;
      }
      setTokens(Array.isArray(data) ? (data as TokenRow[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fleet");
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCampaigns();
  }, []);

  useEffect(() => {
    loadFleet();
  }, []);

  async function handleBulkAssign() {
    if (!selectedCampaignId) {
      setAssignMessage({ type: "error", text: "Select a campaign first." });
      return;
    }
    if (selectedTokenIds.size === 0) {
      setAssignMessage({ type: "error", text: "Select at least one asset." });
      return;
    }
    setIsAssigning(true);
    setAssignMessage(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("tokens")
      .update({ campaign_id: selectedCampaignId })
      .in("id", Array.from(selectedTokenIds));
    setIsAssigning(false);
    if (err) {
      setAssignMessage({ type: "error", text: err.message });
      return;
    }
    setAssignMessage({
      type: "success",
      text: `Campaign assigned to ${selectedTokenIds.size} asset(s) successfully!`,
    });
    setSelectedTokenIds(new Set());
    loadFleet();
  }

  const handleReset = async () => {
    const { resetDemo } = await import("@/app/actions");
    setIsResetting(true);
    setError(null);
    setAssignMessage(null);
    try {
      await resetDemo();
      await loadFleet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setIsResetting(false);
    }
  };

  const toggleOne = (id: string) => {
    setSelectedTokenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedTokenIds(checked ? new Set(tokens.map((t) => t.id)) : new Set());
  };

  const lat = (t: Record<string, unknown>) =>
    (t.lat as number) ?? (t.latitude as number);
  const lng = (t: Record<string, unknown>) =>
    (t.lng as number) ?? (t.longitude as number);
  const valUsd = (t: Record<string, unknown>) => {
    const v = t.val_usd as number | undefined;
    return v != null ? (v / 100).toFixed(2) : "—";
  };
  const campaignName = (t: TokenRow) =>
    t.campaigns && typeof t.campaigns === "object" && "name" in t.campaigns
      ? String((t.campaigns as { name: string }).name)
      : "Unassigned";

  return (
    <div className="min-h-screen bg-black p-8 font-sans text-white">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold uppercase tracking-tighter text-green-500">
          Fleet Command
        </h1>
        <button
          onClick={handleReset}
          disabled={isResetting}
          className="rounded bg-red-600 px-4 py-2 text-xs font-bold uppercase text-white transition-all hover:bg-red-700 disabled:opacity-50"
        >
          {isResetting ? "Resetting..." : "Reset All Assets"}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/50 bg-red-900/20 p-4 text-red-400">
          <strong>Supabase error:</strong> {error}
        </div>
      )}

      {assignMessage && (
        <div
          className={`mb-6 rounded-lg p-4 ${
            assignMessage.type === "success"
              ? "border border-green-500/50 bg-green-900/20 text-green-400"
              : "border border-red-500/50 bg-red-900/20 text-red-400"
          }`}
        >
          {assignMessage.text}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500">Loading assets from Supabase...</p>
      ) : tokens.length === 0 ? (
        <p className="text-zinc-500">
          No assets in the <code className="rounded bg-zinc-800 px-1">tokens</code> table.
          Add rows in Supabase to see them here.
        </p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <select
              value={selectedCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
              className="rounded border border-gray-700 bg-gray-900 p-2 text-sm"
            >
              <option value="">Select campaign to assign...</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleBulkAssign}
              disabled={!selectedCampaignId || selectedTokenIds.size === 0 || isAssigning}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-bold disabled:opacity-50"
            >
              {isAssigning ? "Assigning..." : "Bulk Assign"}
            </button>
            <span className="text-xs text-zinc-500">
              {selectedTokenIds.size} selected
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10 bg-zinc-900/30">
            <table className="w-full text-left">
              <thead className="bg-white/5 text-[10px] uppercase tracking-widest text-zinc-500">
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
                  <th className="p-4">Status</th>
                  <th className="p-4">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tokens.map((token) => (
                  <tr key={String(token.id)} className="hover:bg-white/5">
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedTokenIds.has(token.id)}
                        onChange={() => toggleOne(token.id)}
                      />
                    </td>
                    <td className="p-4 font-mono text-sm">
                      {String(token.id).slice(-8)}
                    </td>
                    <td className="p-4 font-mono text-sm text-zinc-400">
                      {lat(token) != null && lng(token) != null
                        ? `${Number(lat(token)).toFixed(4)}, ${Number(lng(token)).toFixed(4)}`
                        : "—"}
                    </td>
                    <td className="p-4 text-emerald-400">
                      {campaignName(token)}
                    </td>
                    <td className="p-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                          token.status === "active"
                            ? "bg-green-500 text-black"
                            : "bg-zinc-700 text-zinc-400"
                        }`}
                      >
                        {String(token.status ?? "—")}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-zinc-400">
                      ${valUsd(token)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
