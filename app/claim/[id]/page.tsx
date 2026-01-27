import { createClient } from "@supabase/supabase-js";
import ClaimForm from "@/components/claim-form";
import type { Campaign, Token } from "@/types";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function normalizeClaimId(raw: string): string {
  let s = String(raw ?? "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // leave as-is if decoding fails
  }
  s = s.replace(/%20/g, "").replace(/\s+/g, " ").trim();
  // Extract UUID pattern (without anchors for extraction, but validate with anchors later)
  const uuidPattern = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/i;
  const match = s.match(uuidPattern);
  if (match) return match[0].toLowerCase();
  return s;
}

/** Strict UUID validation - returns true only if the string is exactly a valid UUID. */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
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
  // SAFETY 1: Fail Fast - Strict UUID validation before ANY database call
  if (!UUID_REGEX.test(id)) {
    console.warn(`⚠️ [Claim] Invalid UUID format: ${id}`);
    return null;
  }

  // SAFETY 2: Initialize Supabase client (no DB call yet)
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    console.error("❌ [Claim] Service Role Client failed to initialize.");
    return null;
  }

  // SAFETY 3: Crash Protection - Wrap ALL database operations in try/catch
  try {
    // Query tokens table
    const { data: token, error: tokenError } = await supabaseAdmin
      .from("tokens")
      .select("id, lat, lng, status, organization_id, campaign_id")
      .eq("id", id)
      .maybeSingle();

    if (tokenError) {
      console.error("❌ [Claim] Token query error:", tokenError.message);
      return null;
    }

    if (!token) {
      console.warn("❌ [Claim] Token not found in DB:", id);
      return null;
    }

    // Map token data safely
    const tokenData: Token = {
      id: token.id,
      lat: Number(token.lat) || 0,
      lng: Number(token.lng) || 0,
      status: token.status === "found" ? "found" : "active",
      organization_id: token.organization_id ?? null,
    };

    // Fetch campaign if token has one (also wrapped in try/catch for safety)
    const campaignId = token.campaign_id ?? null;
    let campaign: Campaign | null = null;

    if (campaignId) {
      try {
        const { data: camp, error: campError } = await supabaseAdmin
          .from("campaigns")
          .select("*")
          .eq("id", campaignId)
          .maybeSingle(); // Use maybeSingle() instead of single() to avoid throwing

        if (!campError && camp) {
          campaign = camp as Campaign;
        } else if (campError) {
          console.warn("⚠️ [Claim] Campaign fetch error (non-fatal):", campError.message);
          // Continue without campaign - token is still valid
        }
      } catch (campErr) {
        console.warn("⚠️ [Claim] Campaign fetch exception (non-fatal):", campErr);
        // Continue without campaign - token is still valid
      }
    }

    return { token: tokenData, campaign };
  } catch (err) {
    // Catch ANY exception from database operations
    console.error("🔥 [Claim] CRITICAL DB EXCEPTION:", err);
    return null; // Return null instead of crashing - NEVER throw
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

  if (!rawId) {
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

  // Pass normalized ID to the safe function
  const result = await getTokenForClaim(normalizedId);

  // 2. Token not found (or DB error)
  if (!result) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <h1 className="mb-4 text-4xl font-bold text-red-500">TOKEN NOT FOUND</h1>
        <p className="max-w-md text-center text-zinc-400">
          The token ID is invalid or could not be retrieved.
        </p>
      </div>
    );
  }

  const { token, campaign } = result;

  // 3. Already claimed check
  if (token.status === "found") {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <div className="mb-4 text-6xl">💀</div>
        <h1 className="text-2xl font-bold text-zinc-300">ALREADY CLAIMED</h1>
      </div>
    );
  }

  // 4. Token has no campaign (Unassigned) – block claim
  if (!campaign) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <h1 className="text-xl font-bold text-amber-500">This asset is not currently active.</h1>
        <p className="mt-2 max-w-md text-center text-zinc-400">
          This token is not assigned to a campaign. Contact the organizer if you believe this is an error.
        </p>
      </div>
    );
  }

  // 5. Campaign is archived – block claim
  if ((campaign as Campaign & { deleted_at?: string | null }).deleted_at) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-black p-6 text-white">
        <h1 className="text-xl font-bold text-amber-500">This campaign has ended.</h1>
        <p className="mt-2 max-w-md text-center text-zinc-400">
          Submissions are no longer accepted for this campaign.
        </p>
      </div>
    );
  }

  // Pass plain serializable props to avoid RSC digest errors (Supabase rows can have non-plain values)
  const campaignPlain =
    campaign === null
      ? null
      : (JSON.parse(JSON.stringify(campaign)) as Campaign);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black p-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-xl">
        <ClaimForm tokenId={token.id} campaign={campaignPlain} />
      </div>
    </main>
  );
}
