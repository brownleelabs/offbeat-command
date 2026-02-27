/**
 * Rain Barrel + Slow Rail: yield-distribution cron.
 * GET: Secured by CRON_SECRET. Fetches BENJI yield, mints/activates DORMANT tokens (assigns asset_uuid, balance 25).
 * Then runs settlement (REDEEMED last 24h → transferCreate; optional buffer refill).
 */

import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/auth-server";
import { getWalletYield } from "@/lib/benji-client";
import { runSettlement } from "@/lib/settlement-engine";

const TOKEN_VALUE_USD = 25;

/** Circuit breaker: max tokens to mint per cron run (prevents yield-spike / API glitch mass-mint). */
const MAX_MINT_PER_RUN = 50;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const walletId = process.env.BENJI_UNIVERSITY_WALLET_ID;
  if (!walletId) {
    console.error("[yield-distribution] Missing BENJI_UNIVERSITY_WALLET_ID");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseService();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  try {
    const yieldData = await getWalletYield(walletId);
    if (!yieldData) {
      return NextResponse.json(
        { error: "Failed to fetch BENJI yield", minted: 0 },
        { status: 502 }
      );
    }

    const currentEstAmount = Number(yieldData.currentEstAmount) || 0;
    const { data: settings } = await supabase
      .from("site_settings")
      .select("benji_last_checked_amount")
      .eq("id", 1)
      .maybeSingle();

    const settingsRow = settings as { benji_last_checked_amount?: number | null } | null;
    const lastChecked =
      settingsRow?.benji_last_checked_amount != null
        ? Number(settingsRow.benji_last_checked_amount)
        : 0;
    const newYield = Math.max(0, currentEstAmount - lastChecked);
    const calculatedTokens = Math.floor(newYield / TOKEN_VALUE_USD);
    const tokensToMint = Math.min(calculatedTokens, MAX_MINT_PER_RUN);

    if (calculatedTokens > MAX_MINT_PER_RUN) {
      console.warn(
        "[yield-distribution] Yield spike circuit breaker: calculated tokens %d exceeds cap %d; minting only %d this run.",
        calculatedTokens,
        MAX_MINT_PER_RUN,
        tokensToMint
      );
    }

    let minted = 0;
    if (tokensToMint > 0) {
      const { data: dormantRows, error: fetchErr } = await supabase
        .from("tokens")
        .select("id")
        .eq("status", "DORMANT")
        .limit(tokensToMint);

      if (fetchErr) {
        console.error("[yield-distribution] DORMANT fetch error:", fetchErr);
        return NextResponse.json(
          { error: "Failed to fetch DORMANT tokens", minted: 0 },
          { status: 500 }
        );
      }

      const rows = Array.isArray(dormantRows) ? dormantRows : [];
      for (const row of rows) {
        const id = (row as { id: string }).id;
        if (!id) continue;
        const assetUuid = crypto.randomUUID();
        const { error: updateErr } = await (supabase as any)
          .from("tokens")
          .update({
            status: "ACTIVE",
            asset_uuid: assetUuid,
            balance: TOKEN_VALUE_USD,
          })
          .eq("id", id);
        if (!updateErr) minted++;
      }

      // Critical: persist consumed yield so the next run does not double-mint. If this fails, report failure.
      const newLastChecked = lastChecked + minted * TOKEN_VALUE_USD;
      const { error: settingsErr } = await (supabase as any)
        .from("site_settings")
        .update({
          benji_last_checked_amount: newLastChecked,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);

      if (settingsErr) {
        console.error("[yield-distribution] site_settings update failed after minting:", settingsErr.message, { minted, newLastChecked });
        return NextResponse.json(
          {
            error: "Failed to persist mint tracking; yield state not updated. Fix site_settings and reconcile benji_last_checked_amount.",
            minted,
            details: settingsErr.message,
          },
          { status: 500 }
        );
      }
    }

    // Slow Rail: REDEEMED last 24h → transferCreate; optional withdrawalCreate for buffer refill
    let settlement: { ok: boolean; redeemedCount?: number; totalValue?: number; transferId?: string | null; withdrawalId?: string | null; error?: string } = { ok: false };
    try {
      const result = await runSettlement();
      settlement = { ok: result.ok, redeemedCount: result.redeemedCount, totalValue: result.totalValue, transferId: result.transferId, withdrawalId: result.withdrawalId, error: result.error };
    } catch (settleErr) {
      console.error("[yield-distribution] settlement error:", settleErr);
      settlement = { ok: false, error: settleErr instanceof Error ? settleErr.message : "Settlement failed" };
    }

    return NextResponse.json({ minted, settlement });
  } catch (err) {
    console.error("[yield-distribution] error:", err);
    return NextResponse.json(
      { error: "Internal error", minted: 0 },
      { status: 500 }
    );
  }
}
