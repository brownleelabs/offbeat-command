import { createClient } from "@supabase/supabase-js";
import ClaimForm from "@/components/claim-form";
import { getRedemptionSuccessMessage } from "@/app/actions";
import type { Campaign, Token } from "@/types";

// STRICT REGEX: Anchors (^...$) prevent invalid IDs from hitting the DB
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

function normalizeClaimId(raw: string): string {
  let s = String(raw ?? "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // leave as-is
  }
  s = s.replace(/%20/g, "").replace(/\s+/g, " ").trim();
  
  // Extract UUID if present
  const match = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (match) return match[0].toLowerCase();
  return s;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("❌ [Claim] FATAL: Missing SUPABASE_SERVICE_ROLE_KEY or URL.");
    return null;
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function getTokenForClaim(
  id: string
): Promise<{ token: Token; campaign: Campaign | null } | null> {
  // 1. FAIL FAST: Validates strictly. If not UUID, return null (prevents 500 DB error).
  if (!isValidUUID(id)) {
     console.warn(`⚠️ [Claim] Invalid UUID format: ${id}`);
     return null;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    console.error("❌ [Claim] Client init failed.");
    return null;
  }

  // 2. SAFETY NET: Wraps DB call in try/catch to stop server crashes.
  try {
    const { data: token, error } = await supabaseAdmin
      .from("tokens")
      .select("id, lat, lng, status, organization_id, campaign_id, balance")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("❌ [Claim] DB Error:", error.message);
      return null;
    }

    if (!token) {
      console.warn("❌ [Claim] Token not found in DB:", id);
      return null;
    }

    const balance = token.balance != null ? Number(token.balance) : 0;
    const tokenData: Token & { balance?: number } = {
      id: token.id,
      lat: Number(token.lat) || 0,
      lng: Number(token.lng) || 0,
      status: token.status === "found" ? "found" : "active",
      organization_id: token.organization_id ?? null,
      ...(Number.isFinite(balance) ? { balance } : {}),
    };

    let campaign: Campaign | null = null;
    const rawCampaignId = token.campaign_id;
    const campaignId =
      typeof rawCampaignId === "string" &&
      rawCampaignId.trim().length > 0 &&
      isValidUUID(rawCampaignId.trim())
        ? rawCampaignId.trim()
        : null;
    if (campaignId) {
      const { data: camp } = await supabaseAdmin
        .from("campaigns")
        .select("*")
        .eq("id", campaignId)
        .single();
      if (camp) campaign = camp as Campaign;
    }

    return { token: tokenData, campaign };

  } catch (err) {
    console.error("🔥 [Claim] CRITICAL EXCEPTION:", err);
    return null; // Return null instead of crashing
  }
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rawId = Array.isArray(id) ? id[0] : id ?? "";
  const normalizedId = normalizeClaimId(rawId);
  
  if (!normalizedId) {
    return <ErrorScreen title="INVALID LINK" msg="No token ID provided." />;
  }

  // Pass STRICT normalized ID to safe function
  const result = await getTokenForClaim(normalizedId);

  if (!result) {
    return <ErrorScreen title="TOKEN NOT FOUND" msg="ID is invalid or does not exist." />;
  }

  const { token, campaign } = result;

  if (token.status === "found") {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <div className="mb-4 text-6xl">💀</div>
        <h1 className="text-2xl font-bold text-zinc-300">ALREADY CLAIMED</h1>
      </div>
    );
  }

  const tokenBalance = (token as Token & { balance?: number }).balance;
  const hasValue = tokenBalance != null && Number(tokenBalance) > 0;
  if (!hasValue) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <div className="mb-4 text-6xl">🔒</div>
        <h1 className="text-2xl font-bold text-zinc-300">NO VALUE</h1>
        <p className="mt-2 text-center text-zinc-500">This token has no balance and cannot be redeemed.</p>
      </div>
    );
  }

  const redemptionMessage = await getRedemptionSuccessMessage();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black p-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-xl">
        <ClaimForm
          tokenId={token.id}
          campaign={campaign}
          redemptionSuccessNote={redemptionMessage.note}
          redemptionSuccessLink={redemptionMessage.link}
        />
      </div>
    </main>
  );
}

function ErrorScreen({ title, msg }: { title: string; msg: string }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
      <h1 className="mb-4 text-4xl font-bold text-red-500">{title}</h1>
      <p className="max-w-md text-center text-zinc-400">{msg}</p>
    </div>
  );
}