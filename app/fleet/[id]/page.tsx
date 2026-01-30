"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, deleteToken, loadFundsToToken } from "@/app/fleet/fleet-actions";
import { useDashboard } from "@/components/dashboard-context";
import { ArrowLeft, Copy, Trash2, DollarSign } from "lucide-react";
import type { FleetTokenDetail } from "@/types";

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function copyToClipboard(text: string, _label: string): void {
  try {
    navigator.clipboard.writeText(text);
    // Optional: could show a toast
  } catch {
    // ignore
  }
}

export default function FleetAssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { userRole } = useDashboard();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fundAmount, setFundAmount] = useState<string>("25");
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [token, setToken] = useState<FleetTokenDetail | null>(null);

  useEffect(() => {
    if (!id || !isUuidLike(id)) {
      setNotFound(true);
      setToken(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getToken(id);
        if (cancelled) return;
        if (!res.success) {
          setError(res.error ?? "Failed to load asset.");
          if (res.error === "Token not found." || res.error === "Invalid token ID.") {
            setNotFound(true);
          }
          setToken(null);
          return;
        }
        setToken(res.token);
        setError(null);
        setNotFound(false);
      } catch {
        if (!cancelled) {
          setError("Failed to load asset.");
          setNotFound(true);
          setToken(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-muted-foreground">Loading asset…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-xl font-bold">Asset not found</h1>
          <p className="text-muted-foreground">
            {error ?? "The asset may have been removed or you don't have access."}
          </p>
        </div>
      </div>
    );
  }

  if (error && !token) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-xl font-bold">Error</h1>
          <p className="text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return null;
  }

  const balanceDisplay = token.balance != null ? `$${token.balance}` : "$0";
  const balanceNum = token.balance != null ? Number(token.balance) : 0;
  const canDelete = userRole === "SUPER_ADMIN" && balanceNum === 0;
  const isSuperAdmin = userRole === "SUPER_ADMIN";

  async function handleDelete() {
    if (!canDelete || !token) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteToken(token.id);
      if (res.success) {
        router.replace("/dashboard?tab=fleet");
        return;
      }
      setError(res.error ?? "Delete failed.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  async function handleLoadFunds() {
    if (!token || !isSuperAdmin) return;
    const amt = Number(fundAmount);
    if (!Number.isFinite(amt) || amt < 1 || amt > 25) {
      setFundError("Enter an amount from $1 to $25. You cannot load $0; use Remove funds in Settings to zero a token.");
      return;
    }
    if (token.status === "REDEEMED") {
      const confirmed = window.confirm(
        "This token has already been redeemed. Adding funds will not change who redeemed it. Add funds anyway?"
      );
      if (!confirmed) return;
    }
    setFunding(true);
    setFundError(null);
    try {
      const res = await loadFundsToToken(token.id, amt);
      if (res.success) {
        const refetched = await getToken(token.id);
        if (refetched.success && refetched.token) setToken(refetched.token);
        setFundAmount("25");
      } else {
        setFundError(res.error ?? "Load funds failed.");
      }
    } finally {
      setFunding(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Fleet
        </Link>

        <h1 className="text-2xl font-bold">Asset details</h1>

        <div className="rounded-lg border border-white/10 bg-slate-900/50 overflow-hidden">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-white/10">
              <tr>
                <td className="p-4 font-medium text-muted-foreground w-40">Asset ID</td>
                <td className="p-4 font-mono text-xs break-all">
                  {token.id}
                  <button
                    type="button"
                    onClick={() => copyToClipboard(token.id, "ID")}
                    className="ml-2 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    title="Copy ID"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-muted-foreground">Status</td>
                <td className="p-4">
                  <span
                    className={
                      token.status === "ACTIVE"
                        ? "rounded px-2 py-1 font-mono text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400"
                        : "rounded px-2 py-1 font-mono text-[10px] font-bold uppercase bg-white/5 text-muted-foreground"
                    }
                  >
                    {token.status === "ACTIVE" ? "Active (value sitting)" : "Redeemed"}
                  </span>
                </td>
              </tr>
              {token.status === "ACTIVE" && token.created_at && (
                <tr>
                  <td className="p-4 font-medium text-muted-foreground">Value sitting since</td>
                  <td className="p-4 text-xs">{new Date(token.created_at).toLocaleString()}</td>
                </tr>
              )}
              {token.redeemer && (token.redeemer.first_name || token.redeemer.last_name || token.redeemer.student_email || token.redeemer.student_id) && (
                <>
                  <tr>
                    <td className="p-4 font-medium text-muted-foreground">Redeemed by (name)</td>
                    <td className="p-4 text-xs">{[token.redeemer.first_name, token.redeemer.last_name].filter(Boolean).join(" ") || "—"}</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-medium text-muted-foreground">Redeemed by (email)</td>
                    <td className="p-4 text-xs break-all">{token.redeemer.student_email || "—"}</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-medium text-muted-foreground">Redeemed by (student ID)</td>
                    <td className="p-4 text-xs font-mono">{token.redeemer.student_id || "—"}</td>
                  </tr>
                </>
              )}
              <tr>
                <td className="p-4 font-medium text-muted-foreground">Organization</td>
                <td className="p-4">{token.organizations?.name ?? "—"}</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-muted-foreground">Active campaign</td>
                <td className="p-4 font-bold text-success">{token.campaigns?.name ?? "Unassigned"}</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-muted-foreground">Balance</td>
                <td className="p-4 font-mono">{balanceDisplay}</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-muted-foreground">Coordinates</td>
                <td className="p-4 font-mono text-xs">
                  {token.lat.toFixed(4)}, {token.lng.toFixed(4)}
                </td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-muted-foreground">Created</td>
                <td className="p-4 text-xs">{token.created_at ? new Date(token.created_at).toLocaleString() : "—"}</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-muted-foreground">Last tapped (redeemed)</td>
                <td className="p-4 text-xs">{token.redeemed_at ? new Date(token.redeemed_at).toLocaleString() : "—"}</td>
              </tr>
              {token.reloaded_at && (
                <tr>
                  <td className="p-4 font-medium text-muted-foreground">Reloaded at</td>
                  <td className="p-4 text-xs">{new Date(token.reloaded_at).toLocaleString()}</td>
                </tr>
              )}
              {token.status === "ACTIVE" && token.first_redeemer && (token.first_redeemer.first_name || token.first_redeemer.last_name || token.first_redeemer.student_email || token.first_redeemer.student_id) && (
                <>
                  <tr>
                    <td className="p-4 font-medium text-muted-foreground">First redeemed by (name)</td>
                    <td className="p-4 text-xs">{[token.first_redeemer.first_name, token.first_redeemer.last_name].filter(Boolean).join(" ") || "—"}</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-medium text-muted-foreground">First redeemed by (email)</td>
                    <td className="p-4 text-xs break-all">{token.first_redeemer.student_email || "—"}</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-medium text-muted-foreground">First redeemed by (student ID)</td>
                    <td className="p-4 text-xs font-mono">{token.first_redeemer.student_id || "—"}</td>
                  </tr>
                </>
              )}
              {token.claim_url ? (
                <tr>
                  <td className="p-4 font-medium text-muted-foreground">Claim URL</td>
                  <td className="p-4">
                    <span className="font-mono text-xs break-all text-muted-foreground">{token.claim_url}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(token.claim_url!, "URL")}
                      className="ml-2 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      title="Copy URL"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ) : token.claim_url_restricted ? (
                <tr>
                  <td className="p-4 font-medium text-muted-foreground">Claim URL</td>
                  <td className="p-4 text-muted-foreground italic">(restricted)</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {isSuperAdmin && (
          <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4 space-y-4">
            <h2 className="text-lg font-semibold">Fund &amp; manage</h2>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Load funds to this token ($1–$25)</span>
                <input
                  type="number"
                  min={1}
                  max={25}
                  step={1}
                  value={fundAmount}
                  onChange={(e) => { setFundAmount(e.target.value); setFundError(null); }}
                  className="w-28 rounded border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm"
                />
              </label>
              <button
                type="button"
                onClick={handleLoadFunds}
                disabled={funding}
                className="inline-flex items-center gap-2 rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                <DollarSign className="h-4 w-4" />
                {funding ? "Loading…" : "Load funds"}
              </button>
            </div>
            {fundError && <p className="text-sm text-destructive">{fundError}</p>}
            <p className="text-xs text-muted-foreground">
              Tokens start at $0. Load $1–$25 here (max $25 per token). To remove funds, use Remove funds in Settings or redeem the token. When BENJI is connected, real bank balance will validate uploads.
            </p>
          </div>
        )}

        {canDelete && (
          <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
            <h2 className="text-lg font-semibold text-muted-foreground">Danger zone</h2>
            {!deleteConfirm ? (
              <button
                type="button"
                onClick={() => setDeleteConfirm(true)}
                className="mt-2 inline-flex items-center gap-2 rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20"
              >
                <Trash2 className="h-4 w-4" />
                Delete token
              </button>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Remove this token permanently?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded border border-red-500/50 bg-red-500/20 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(false)}
                  disabled={deleting}
                  className="rounded border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Only tokens with $0 balance can be deleted. Zero the balance first if needed.
            </p>
          </div>
        )}
        {userRole === "SUPER_ADMIN" && balanceNum > 0 && (
          <p className="text-sm text-muted-foreground">
            To delete this token, zero its balance first (e.g. after redemption or manual adjustment).
          </p>
        )}
      </div>
    </div>
  );
}
