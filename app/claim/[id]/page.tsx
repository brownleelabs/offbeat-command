import { createClient } from "@supabase/supabase-js";
import ClaimForm from "@/components/claim-form";
import type { Campaign, Token } from "@/types";

const UUID_REGEX =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function normalizeClaimId(raw: string): string {
  let s = String(raw ?? "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // leave as-is if decoding fails
  }
  s = s.replace(/%20/g, "").replace(/\s+/g, " ").trim();
  const match = s.match(UUID_REGEX);
  if (match) return match[0].toLowerCase();
  return s;
}

// Lazy load helper – prevents "supabaseKey is required" crash at startup
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
  const supabaseAdmin = getSupabaseAdmin();

  if (!supabaseAdmin) {
    console.error("❌ [Claim] Service Role Client failed to initialize.");
    return null;
  }

  const normalizedId = normalizeClaimId(id);
  console.log(`🔍 [Claim] Looking up token: ${normalizedId}`);

  const { data: token, error } = await supabaseAdmin
    .from("tokens")
    .select("id, lat, lng, status, organization_id, campaign_id")
    .eq("id", normalizedId)
    .maybeSingle();

  if (error) {
    console.error("❌ [Claim] DB Error:", error.message);
    return null;
  }

  if (!token) {
    console.error("❌ [Claim] Token not found:", normalizedId);
    return null;
  }

  const tokenData: Token = {
    id: (token as { id: string }).id,
    lat: Number((token as { lat: number }).lat) || 0,
    lng: Number((token as { lng: number }).lng) || 0,
    status: (token as { status: string }).status === "found" ? "found" : "active",
    organization_id: (token as { organization_id?: string | null }).organization_id ?? null,
  };

  const campaignId = (token as { campaign_id?: string | null }).campaign_id ?? null;
  let campaign: Campaign | null = null;
  if (campaignId) {
    const { data: camp } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    campaign = (camp as Campaign) ?? null;
  }

  return { token: tokenData, campaign };
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rawId = Array.isArray(id) ? id[0] : id ?? "";
  const idStr = typeof rawId === "string" ? rawId : "";

  if (!idStr) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <h1 className="text-2xl font-bold text-red-500">INVALID LINK</h1>
        <p className="mt-4 text-zinc-400">No token ID in the URL.</p>
      </div>
    );
  }

  // 1. Detect configuration error (key missing) before calling getTokenForClaim
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <h1 className="text-2xl font-bold text-red-500">CONFIGURATION ERROR</h1>
        <p className="mt-4 text-zinc-400">
          The server is missing the <code className="rounded bg-zinc-800 px-1">SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
        <p className="mt-2 text-sm text-zinc-500">Check .env.local and restart server.</p>
      </div>
    );
  }

  const result = await getTokenForClaim(idStr);

  // 2. Token not found (or DB error)
  if (!result) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <h1 className="mb-4 text-4xl font-bold text-red-500">TOKEN NOT FOUND</h1>
        <p className="max-w-md text-center text-zinc-400">
          This token ID ({idStr.slice(0, 8)}...) does not exist or the link is invalid.
        </p>
      </div>
    );
  }

  const { token, campaign } = result;

  // 3. Already claimed
  if (token.status === "found") {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <div className="mb-4 text-6xl">💀</div>
        <h1 className="text-2xl font-bold text-zinc-300">ALREADY CLAIMED</h1>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black p-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-xl">
        <ClaimForm tokenId={token.id} campaign={campaign} />
      </div>
    </main>
  );
}
