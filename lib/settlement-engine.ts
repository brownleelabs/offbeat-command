/**
 * Slow Rail: Asset reconciliation. Query REDEEMED tokens in last 24h, sum value,
 * call BENJI transferCreate to move value from Active Inventory to Offbeat Operations.
 * Optional: if Venmo buffer < threshold, call withdrawalCreate to refill (USDC path).
 */

import { getSupabaseService } from "@/lib/auth-server";
import { transferCreate, withdrawalCreate } from "@/lib/benji-client";

const TOKEN_VALUE_USD = 25;
const VENMO_BUFFER_THRESHOLD = 50_000;

/** Stuck PENDING_SETTLEMENT older than this are reverted to ACTIVE (zombie cleanup). */
const STUCK_PENDING_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export type SettlementResult = {
  ok: boolean;
  redeemedCount?: number;
  totalValue?: number;
  transferId?: string | null;
  withdrawalId?: string | null;
  error?: string;
};

/**
 * Zombie cleanup: find tokens stuck in PENDING_SETTLEMENT longer than 1 hour, revert to ACTIVE.
 * Call from runSettlement so it runs every time the cron fires.
 */
export async function cleanupStuckTokens(): Promise<{ fixed: number }> {
  const supabase = getSupabaseService();
  if (!supabase) {
    return { fixed: 0 };
  }

  const olderThan = new Date(Date.now() - STUCK_PENDING_THRESHOLD_MS).toISOString();
  const { data: stuckRows, error: fetchErr } = await supabase
    .from("tokens")
    .select("id")
    .eq("status", "PENDING_SETTLEMENT")
    .lt("updated_at", olderThan);

  if (fetchErr) {
    console.error("[settlement-engine] cleanupStuckTokens fetch error:", fetchErr);
    return { fixed: 0 };
  }

  const ids = Array.isArray(stuckRows) ? (stuckRows as { id: string }[]).map((r) => r.id) : [];
  if (ids.length === 0) {
    return { fixed: 0 };
  }

  const { data: updated, error: updateErr } = await (supabase as any)
    .from("tokens")
    .update({ status: "ACTIVE" })
    .in("id", ids)
    .select("id");

  if (updateErr) {
    console.error("[settlement-engine] cleanupStuckTokens update error:", updateErr);
    return { fixed: 0 };
  }

  const fixed = Array.isArray(updated) ? updated.length : 0;
  if (fixed > 0) {
    console.warn("[settlement-engine] Zombie token cleanup: reverted %d stuck PENDING_SETTLEMENT token(s) to ACTIVE.", fixed);
  }
  return { fixed };
}

/**
 * Query tokens REDEEMED in the last 24 hours, sum value, and optionally run BENJI transfer + buffer refill.
 * Call from cron or a scheduled job.
 */
export async function runSettlement(options?: {
  offbeatWalletAddress?: string;
  universityWalletId?: string;
  productId?: string;
  paymentInstructionId?: string;
  skipTransfer?: boolean;
  skipWithdrawalCheck?: boolean;
}): Promise<SettlementResult> {
  const supabase = getSupabaseService();
  if (!supabase) {
    return { ok: false, error: "Server configuration error" };
  }

  // Zombie cleanup: revert stuck PENDING_SETTLEMENT (> 1h) to ACTIVE before settlement
  await cleanupStuckTokens();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error: fetchErr } = await supabase
    .from("tokens")
    .select("id, balance, asset_uuid")
    .eq("status", "REDEEMED")
    .gte("redeemed_at", since);

  if (fetchErr) {
    console.error("[settlement-engine] fetch REDEEMED error:", fetchErr);
    return { ok: false, error: fetchErr.message };
  }

  const list = Array.isArray(rows) ? rows : [];
  const totalValue = list.reduce((sum, r) => sum + (Number((r as { balance?: number }).balance) || TOKEN_VALUE_USD), 0);
  const redeemedCount = list.length;

  if (redeemedCount === 0) {
    return { ok: true, redeemedCount: 0, totalValue: 0 };
  }

  let transferId: string | null = null;
  if (!options?.skipTransfer && totalValue > 0) {
    const recipientWalletAddress = options?.offbeatWalletAddress ?? process.env.BENJI_OFFBEAT_WALLET_ADDRESS;
    const sourceWalletId = options?.universityWalletId ?? process.env.BENJI_UNIVERSITY_WALLET_ID;
    const productId = options?.productId ?? process.env.BENJI_PRODUCT_ID;
    const userId = process.env.BENJI_SYSTEM_USER_ID ?? "offbeat-cron";

    if (recipientWalletAddress && sourceWalletId && productId) {
      const result = await transferCreate({
        sourceWalletId,
        recipientWalletAddress,
        productId,
        quantity: totalValue / TOKEN_VALUE_USD,
        userId,
        buildSigningPackage: false,
        instant: true,
      });
      transferId = result?.transferId ?? null;
    }
  }

  let withdrawalId: string | null = null;
  if (!options?.skipWithdrawalCheck && process.env.VENMO_BUFFER_BALANCE != null) {
    const bufferBalance = Number(process.env.VENMO_BUFFER_BALANCE);
    if (bufferBalance < VENMO_BUFFER_THRESHOLD) {
      const walletId = process.env.BENJI_OFFBEAT_WALLET_ID;
      const productId = options?.productId ?? process.env.BENJI_PRODUCT_ID;
      const paymentInstructionId = options?.paymentInstructionId ?? process.env.BENJI_PAYMENT_INSTRUCTION_ID;
      const userId = process.env.BENJI_SYSTEM_USER_ID ?? "offbeat-cron";

      if (walletId && productId && paymentInstructionId) {
        const valueToWithdraw = Math.min(VENMO_BUFFER_THRESHOLD - bufferBalance, totalValue);
        if (valueToWithdraw > 0) {
          const result = await withdrawalCreate({
            walletId,
            productId,
            value: valueToWithdraw,
            paymentInstructionId,
            userId,
            buildSigningPackage: false,
          });
          withdrawalId = result?.withdrawalId ?? null;
        }
      }
    }
  }

  return {
    ok: true,
    redeemedCount,
    totalValue,
    transferId,
    withdrawalId,
  };
}
