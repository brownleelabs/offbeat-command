"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

export default function FleetPage() {
  const [tokens, setTokens] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  async function loadFleet() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("tokens")
        .select("*")
        .order("id", { ascending: true });
      if (err) {
        setError(err.message);
        setTokens([]);
        return;
      }
      setTokens(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fleet");
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFleet();
  }, []);

  const handleReset = async () => {
    const { resetDemo } = await import("@/app/actions");
    setIsResetting(true);
    setError(null);
    try {
      await resetDemo();
      await loadFleet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setIsResetting(false);
    }
  };

  const lat = (t: Record<string, unknown>) =>
    (t.lat as number) ?? (t.latitude as number);
  const lng = (t: Record<string, unknown>) =>
    (t.lng as number) ?? (t.longitude as number);
  const valUsd = (t: Record<string, unknown>) => {
    const v = t.val_usd as number | undefined;
    return v != null ? (v / 100).toFixed(2) : "—";
  };

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

      {loading ? (
        <p className="text-zinc-500">Loading assets from Supabase...</p>
      ) : tokens.length === 0 ? (
        <p className="text-zinc-500">
          No assets in the <code className="rounded bg-zinc-800 px-1">tokens</code> table.
          Add rows in Supabase to see them here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-zinc-900/30">
          <table className="w-full text-left">
            <thead className="bg-white/5 text-[10px] uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="p-4">Asset ID</th>
                <th className="p-4">Coordinates</th>
                <th className="p-4">Status</th>
                <th className="p-4">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tokens.map((token) => (
                <tr key={String(token.id)} className="hover:bg-white/5">
                  <td className="p-4 font-mono text-sm">
                    {String(token.id).slice(-8)}
                  </td>
                  <td className="p-4 font-mono text-sm text-zinc-400">
                    {lat(token) != null && lng(token) != null
                      ? `${Number(lat(token)).toFixed(4)}, ${Number(lng(token)).toFixed(4)}`
                      : "—"}
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
      )}
    </div>
  );
}
