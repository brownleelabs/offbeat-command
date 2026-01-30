'use server'

import { createServerSupabase } from '@/lib/supabase-server'
import { getSupabaseService, requireSuperAdmin, requireProfile } from '@/lib/auth-server'
import { getClaimUrl } from '@/lib/constants'
import { isUuidLike, clampInt, BATCH_LIMIT } from '@/lib/validation'
import type { BulkAssignToSchoolResult } from '@/lib/actions-constants'
import { canTransition } from '@/lib/token-logic'
import { normalizeTokenStatus } from '@/types'
import type { TokenStatus, MapTokenRow, FleetTokenDetail } from '@/types'

/** Fleet tab design max: pagination and total count cap (500k tokens). */
const MAX_TOKENS_DESIGN = 500_000
/** Max page number (500k / pageSize 10 = 50k pages). */
const MAX_PAGE = 50_000
/** Max tokens returned for map view (bounded; same scope as Fleet list). Clustering may be needed for very large fleets. */
const MAP_TOKENS_LIMIT = 2000

export type FleetAuditEventType =
  | 'campaign_assigned'
  | 'organization_assigned'
  | 'urls_exported'
  | 'token_created'
  | 'token_reloaded'
  | 'token_deleted'
  | 'token_funded'
  | 'tokens_funded_bulk'
  | 'funds_removed'

/** For list/mutations: SuperAdmin or ORG_ADMIN with fleet_write (org-scoped). Returns userId and org filter. */
async function requireFleetAccess(): Promise<
  { ok: true; userId: string | null; organizationId: string | null } | { ok: false; error: string }
> {
  const profileResult = await requireProfile()
  if (!profileResult.ok) return { ok: false, error: profileResult.error }
  const { userId, role, organizationId } = profileResult
  if (role === 'SUPER_ADMIN') return { ok: true, userId, organizationId: null }
  if (role === 'ORG_ADMIN' && organizationId) {
    const supabase = await createServerSupabase()
    const { data: perms } = await supabase
      .from('role_permissions')
      .select('enabled')
      .eq('role', 'ORG_ADMIN')
      .eq('permission_key', 'fleet_write')
      .maybeSingle()
    if ((perms as { enabled?: boolean } | null)?.enabled) {
      return { ok: true, userId, organizationId }
    }
  }
  return { ok: false, error: 'You do not have permission to manage fleet.' }
}

/** Non-blocking insert; do not throw. */
async function logFleetAudit(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  eventType: FleetAuditEventType,
  actorUserId: string | null,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase.from('fleet_audit_log').insert({
      event_type: eventType,
      actor_user_id: actorUserId,
      payload: payload ?? null,
    })
    if (error) {
      console.error('[fleet-actions] audit log insert failed:', { eventType, err: error })
    }
  } catch (err) {
    console.error('[fleet-actions] audit log insert failed:', { eventType, err })
  }
}

// ---------------------------------------------------------------------------
// Create tokens (SUPER_ADMIN only)
// ---------------------------------------------------------------------------

const CREATE_TOKENS_MAX = 100

export type CreateTokensResult =
  | { success: true; tokens: { id: string; claimUrl: string }[] }
  | { success: false; error: string }

export async function createTokens(count: number): Promise<CreateTokensResult> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const n = clampInt(count, { min: 1, max: CREATE_TOKENS_MAX, fallback: 1 })
    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const rows = Array.from({ length: n }, () => ({
      lat: 0,
      lng: 0,
      status: 'DORMANT' as const,
      organization_id: null,
      campaign_id: null,
    }))

    // Supabase may not have default gen_random_uuid() on tokens.id; generate IDs so we can return claim URLs.
    const ids = Array.from({ length: n }, () => crypto.randomUUID())
    const inserts = rows.map((row, i) => ({ ...row, id: ids[i] }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('tokens').insert(inserts)
    if (error) return { success: false, error: error.message ?? 'Insert failed.' }

    const supabaseAuth = await createServerSupabase()
    await logFleetAudit(supabaseAuth, 'token_created', auth.userId, {
      count: n,
      token_ids: ids,
    })

    const tokens = ids.map((id) => ({ id, claimUrl: getClaimUrl(id) }))
    return { success: true, tokens }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Create tokens failed.' }
  }
}

// ---------------------------------------------------------------------------
// Delete token (SUPER_ADMIN only; only when balance === 0)
// ---------------------------------------------------------------------------

export type DeleteTokenResult =
  | { success: true }
  | { success: false; error: string }

export async function deleteToken(tokenId: string): Promise<DeleteTokenResult> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const id = typeof tokenId === 'string' ? String(tokenId).trim().toLowerCase() : ''
    if (!id || !isUuidLike(id)) {
      return { success: false, error: 'Invalid token ID.' }
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const { data: row, error: fetchError } = await supabase
      .from('tokens')
      .select('id, balance')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) return { success: false, error: fetchError.message ?? 'Failed to load token.' }
    if (!row) return { success: false, error: 'Token not found.' }

    const balance = (row as { balance?: number | null }).balance
    const balanceNum = balance != null ? Number(balance) : 0
    if (balanceNum > 0) {
      return {
        success: false,
        error: 'Cannot delete token with balance > 0. Zero the balance first (e.g. after redemption), or load funds only when ready.',
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteError } = await (supabase as any).from('tokens').delete().eq('id', id)
    if (deleteError) {
      const msg = deleteError.message ?? 'Delete failed.'
      if (msg.includes('foreign key') && msg.toLowerCase().includes('responses')) {
        return {
          success: false,
          error: 'This token has been redeemed and is linked to response data. Run the migration 20260129000021_responses_token_id_on_delete_set_null.sql in the Supabase SQL Editor to allow deletion (response rows are kept for audit with token_id set to null).',
        }
      }
      return { success: false, error: msg }
    }

    const supabaseAuth = await createServerSupabase()
    await logFleetAudit(supabaseAuth, 'token_deleted', auth.userId, { token_id: id })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Delete token failed.' }
  }
}

// ---------------------------------------------------------------------------
// Load funds to token (SUPER_ADMIN only; $1–$25 only; cannot load $0; BENJI will validate real balance later)
// ---------------------------------------------------------------------------

const LOAD_FUNDS_MAX = 25

export type LoadFundsToTokenResult =
  | { success: true; balance: number }
  | { success: false; error: string }

export async function loadFundsToToken(
  tokenId: string,
  amount: number
): Promise<LoadFundsToTokenResult> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const id = typeof tokenId === 'string' ? String(tokenId).trim().toLowerCase() : ''
    if (!id || !isUuidLike(id)) {
      return { success: false, error: 'Invalid token ID.' }
    }

    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 1 || amt > LOAD_FUNDS_MAX) {
      return { success: false, error: `Amount must be between $1 and $${LOAD_FUNDS_MAX}. You cannot load $0; use Remove funds to zero a token.` }
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const { data: row, error: fetchError } = await supabase
      .from('tokens')
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) return { success: false, error: fetchError.message ?? 'Failed to load token.' }
    if (!row) return { success: false, error: 'Token not found.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from('tokens')
      .update({ balance: amt })
      .eq('id', id)

    if (updateError) return { success: false, error: updateError.message ?? 'Update failed.' }

    const supabaseAuth = await createServerSupabase()
    await logFleetAudit(supabaseAuth, 'token_funded', auth.userId, { token_id: id, amount: amt })
    return { success: true, balance: amt }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Load funds failed.' }
  }
}

// ---------------------------------------------------------------------------
// Load funds to multiple tokens (SUPER_ADMIN only; $1–$25 per token; same rules as single load)
// ---------------------------------------------------------------------------

export type LoadFundsToTokensResult =
  | { success: true; count: number; amount: number }
  | { success: false; error: string }

export async function loadFundsToTokens(
  tokenIds: string[],
  amount: number
): Promise<LoadFundsToTokensResult> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const ids = [...new Set(
      (tokenIds ?? [])
        .filter((id) => typeof id === 'string' && isUuidLike(String(id).trim()))
        .map((id) => String(id).trim().toLowerCase())
    )]
    if (ids.length === 0) return { success: false, error: 'No valid token IDs.' }
    if (ids.length > BATCH_LIMIT) {
      return { success: false, error: `Maximum ${BATCH_LIMIT} tokens per batch. Select fewer or run again.` }
    }

    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 1 || amt > LOAD_FUNDS_MAX) {
      return { success: false, error: `Amount must be between $1 and $${LOAD_FUNDS_MAX} per token.` }
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from('tokens')
      .update({ balance: amt })
      .in('id', ids)

    if (updateError) return { success: false, error: updateError.message ?? 'Bulk load failed.' }

    const supabaseAuth = await createServerSupabase()
    await logFleetAudit(supabaseAuth, 'tokens_funded_bulk', auth.userId, {
      token_ids: ids,
      amount: amt,
      count: ids.length,
    })
    return { success: true, count: ids.length, amount: amt }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Bulk load funds failed.' }
  }
}

// ---------------------------------------------------------------------------
// Remove funds from token (SUPER_ADMIN only; sets balance to 0; removed funds return to bank when connected)
// ---------------------------------------------------------------------------

export type RemoveFundsFromTokenResult =
  | { success: true; previous_balance: number }
  | { success: false; error: string }

export async function removeFundsFromToken(tokenId: string): Promise<RemoveFundsFromTokenResult> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const id = typeof tokenId === 'string' ? String(tokenId).trim().toLowerCase() : ''
    if (!id || !isUuidLike(id)) {
      return { success: false, error: 'Invalid token ID.' }
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const { data: row, error: fetchError } = await supabase
      .from('tokens')
      .select('id, balance')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) return { success: false, error: fetchError.message ?? 'Failed to load token.' }
    if (!row) return { success: false, error: 'Token not found.' }

    const balance = (row as { balance?: number | null }).balance
    const prev = balance != null ? Number(balance) : 0
    if (prev <= 0) {
      return { success: false, error: 'Token already has $0 balance. Nothing to remove.' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from('tokens')
      .update({ balance: 0 })
      .eq('id', id)

    if (updateError) return { success: false, error: updateError.message ?? 'Update failed.' }

    const supabaseAuth = await createServerSupabase()
    await logFleetAudit(supabaseAuth, 'funds_removed', auth.userId, { token_id: id, previous_balance: prev })
    return { success: true, previous_balance: prev }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Remove funds failed.' }
  }
}

// ---------------------------------------------------------------------------
// Reload tokens (SUPER_ADMIN only: set redeemed tokens back to active; does not set balance)
// ---------------------------------------------------------------------------

export type ReloadTokensResult =
  | { success: true; count: number }
  | { success: false; error: string }

export async function reloadTokens(tokenIds: string[]): Promise<ReloadTokensResult> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const ids = [...new Set(
      (tokenIds ?? [])
        .filter((id) => typeof id === 'string' && isUuidLike(String(id).trim()))
        .map((id) => String(id).trim())
    )]
    if (ids.length === 0) return { success: false, error: 'No valid token IDs.' }
    if (ids.length > BATCH_LIMIT) {
      return { success: false, error: `Maximum ${BATCH_LIMIT} tokens per reload.` }
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    // Only update tokens that are currently REDEEMED; set to DORMANT (Rain Barrel will re-activate with new asset_uuid).
    if (!canTransition('REDEEMED', 'DORMANT')) {
      return { success: false, error: 'Reload transition not allowed.' }
    }
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (supabase as any)
      .from('tokens')
      .update({ status: 'DORMANT', redeemed_at: null, reloaded_at: now, asset_uuid: null, balance: 0 })
      .in('id', ids)
      .eq('status', 'REDEEMED')
      .select('id')

    if (error) return { success: false, error: error.message ?? 'Update failed.' }
    const count = Array.isArray(updated) ? updated.length : 0

    const supabaseAuth = await createServerSupabase()
    await logFleetAudit(supabaseAuth, 'token_reloaded', auth.userId, {
      token_ids: ids,
      count,
    })

    return { success: true, count }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Reload failed.' }
  }
}

// ---------------------------------------------------------------------------
// List (map: bounded subset for map tab; same org scope as Fleet)
// ---------------------------------------------------------------------------

export type ListTokensForMapResult =
  | { success: true; tokens: MapTokenRow[] }
  | { success: false; error: string }

export type ListTokensForMapOptions = {
  organizationId?: string | null
  campaignId?: string | null
  /** Filter to tokens claimed within the last N hours (only affects status=found). */
  claimedInLastHours?: number | null
}

/** Bounded token list for map tab. Uses same auth/scoping as Fleet; limit MAP_TOKENS_LIMIT. */
export async function listTokensForMap(
  organizationId?: string | null,
  options?: ListTokensForMapOptions
): Promise<ListTokensForMapResult> {
  try {
    const auth = await requireFleetAccess()
    if (!auth.ok) return { success: false, error: auth.error }

    const orgIdFilter =
      organizationId != null && String(organizationId).trim() !== ''
        ? String(organizationId).trim()
        : (options?.organizationId != null && String(options.organizationId).trim() !== ''
            ? String(options.organizationId).trim()
            : null)
    if (orgIdFilter != null && !isUuidLike(orgIdFilter)) {
      return { success: false, error: 'Invalid organization filter.' }
    }
    const campaignIdFilter =
      options?.campaignId != null && String(options.campaignId).trim() !== ''
        ? String(options.campaignId).trim()
        : null
    if (campaignIdFilter != null && !isUuidLike(campaignIdFilter)) {
      return { success: false, error: 'Invalid campaign filter.' }
    }
    const claimedInLastHours = options?.claimedInLastHours != null && Number(options.claimedInLastHours) > 0
      ? Math.min(168, Math.floor(Number(options.claimedInLastHours))) // cap 7 days
      : null

    const supabase = await createServerSupabase()
    let query = supabase
      .from('tokens')
      .select('id, lat, lng, status, organization_id, campaign_id, redeemed_at, nfc_uid, asset_uuid')
      .limit(MAP_TOKENS_LIMIT)
      .order('id', { ascending: true })

    if (auth.organizationId != null) {
      query = query.eq('organization_id', auth.organizationId)
    } else if (orgIdFilter != null) {
      query = query.eq('organization_id', orgIdFilter)
    }
    if (campaignIdFilter != null) {
      query = query.eq('campaign_id', campaignIdFilter)
    }
    if (claimedInLastHours != null) {
      const since = new Date(Date.now() - claimedInLastHours * 60 * 60 * 1000).toISOString()
      query = query.gte('redeemed_at', since)
    }

    const { data, error } = await query
    if (error) return { success: false, error: 'Failed to load tokens for map.' }
    const rows = Array.isArray(data) ? data : []
    const validRows = rows.filter((r: { id?: unknown }) => r?.id != null && typeof r.id === 'string')
    const tokens: MapTokenRow[] = validRows.map((r: {
      id: string
      lat: number
      lng: number
      status: string
      organization_id?: string | null
      campaign_id?: string | null
      redeemed_at?: string | null
      nfc_uid?: string | null
      asset_uuid?: string | null
    }) => {
      const lat = Number(r.lat)
      const lng = Number(r.lng)
      const status = normalizeTokenStatus(r.status)
      return {
        id: r.id,
        lat: Number.isFinite(lat) ? lat : 0,
        lng: Number.isFinite(lng) ? lng : 0,
        status,
        organization_id: r.organization_id ?? null,
        campaign_id: r.campaign_id ?? null,
        redeemed_at: typeof r.redeemed_at === 'string' ? r.redeemed_at : null,
        nfc_uid: r.nfc_uid ?? null,
        asset_uuid: r.asset_uuid ?? null,
      }
    })
    return { success: true, tokens }
  } catch {
    return { success: false, error: 'Failed to load tokens for map.' }
  }
}

// ---------------------------------------------------------------------------
// Map analytics (claims per day, redemption rate)
// ---------------------------------------------------------------------------

export type MapAnalyticsResult =
  | { success: true; total: number; found: number; redemptionRate: number; claimsLast7Days: number }
  | { success: false; error: string }

/** Simple analytics for map/scope: total tokens, found, redemption rate, claims in last 7 days. */
export async function getMapAnalytics(
  organizationId?: string | null
): Promise<MapAnalyticsResult> {
  try {
    const auth = await requireFleetAccess()
    if (!auth.ok) return { success: false, error: auth.error }

    const orgIdFilter =
      organizationId != null && String(organizationId).trim() !== ''
        ? String(organizationId).trim()
        : null
    if (orgIdFilter != null && !isUuidLike(orgIdFilter)) {
      return { success: false, error: 'Invalid organization filter.' }
    }

    const supabase = await createServerSupabase()
    let countQuery = supabase
      .from('tokens')
      .select('id, status', { count: 'exact', head: true })
    if (auth.organizationId != null) {
      countQuery = countQuery.eq('organization_id', auth.organizationId)
    } else if (orgIdFilter != null) {
      countQuery = countQuery.eq('organization_id', orgIdFilter)
    }
    const { count: totalCount } = await countQuery
    const total = typeof totalCount === 'number' && Number.isFinite(totalCount) ? totalCount : 0

    let foundQuery = supabase
      .from('tokens')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'REDEEMED')
    if (auth.organizationId != null) {
      foundQuery = foundQuery.eq('organization_id', auth.organizationId)
    } else if (orgIdFilter != null) {
      foundQuery = foundQuery.eq('organization_id', orgIdFilter)
    }
    const { count: foundCount } = await foundQuery
    const found = typeof foundCount === 'number' && Number.isFinite(foundCount) ? foundCount : 0
    const redemptionRate = total > 0 ? Math.round((found / total) * 100) : 0

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    let claimsQuery = supabase
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since)
    if (auth.organizationId != null) {
      claimsQuery = claimsQuery.eq('organization_id', auth.organizationId)
    } else if (orgIdFilter != null) {
      claimsQuery = claimsQuery.eq('organization_id', orgIdFilter)
    }
    const { count: claimsCount } = await claimsQuery
    const claimsLast7Days = typeof claimsCount === 'number' && Number.isFinite(claimsCount) ? claimsCount : 0

    return {
      success: true,
      total,
      found,
      redemptionRate,
      claimsLast7Days,
    }
  } catch {
    return { success: false, error: 'Failed to load map analytics.' }
  }
}

/** Ghost/Shell/Live counts for Fleet dashboard (6-state model). */
export type TokenStateCounts = {
  minted: number
  dormant: number
  active: number
  pending_settlement: number
  redeemed: number
  void: number
}

export type GetTokenStateCountsResult =
  | { success: true; counts: TokenStateCounts }
  | { success: false; error: string }

/** Token counts by 6-state for Fleet tab (Ghost = MINTED, Shell = DORMANT, Live = ACTIVE). */
export async function getTokenStateCounts(
  organizationId?: string | null
): Promise<GetTokenStateCountsResult> {
  try {
    const auth = await requireFleetAccess()
    if (!auth.ok) return { success: false, error: auth.error }

    const orgFilter =
      organizationId != null && String(organizationId).trim() !== ''
        ? String(organizationId).trim()
        : null
    if (orgFilter != null && !isUuidLike(orgFilter)) {
      return { success: false, error: 'Invalid organization filter.' }
    }

    const supabase = await createServerSupabase()
    const counts: TokenStateCounts = {
      minted: 0,
      dormant: 0,
      active: 0,
      pending_settlement: 0,
      redeemed: 0,
      void: 0,
    }
    const statuses: (keyof TokenStateCounts)[] = ['minted', 'dormant', 'active', 'pending_settlement', 'redeemed', 'void']
    const dbStatuses: TokenStatus[] = ['MINTED', 'DORMANT', 'ACTIVE', 'PENDING_SETTLEMENT', 'REDEEMED', 'VOID']

    await Promise.all(
      dbStatuses.map(async (dbStatus, i) => {
        const key = statuses[i]
        let q = supabase.from('tokens').select('id', { count: 'exact', head: true }).eq('status', dbStatus)
        if (auth.organizationId != null) q = q.eq('organization_id', auth.organizationId)
        else if (orgFilter != null) q = q.eq('organization_id', orgFilter)
        const { count, error } = await q
        if (!error && typeof count === 'number' && count >= 0) {
          counts[key] = Math.min(count, MAX_TOKENS_DESIGN)
        }
      })
    )
    return { success: true, counts }
  } catch {
    return { success: false, error: 'Failed to load token state counts.' }
  }
}

/** Max campaign IDs per request (Campaigns tab integration: asset counts). */
const MAX_CAMPAIGN_IDS_FOR_COUNTS = 100

export type GetTokenCountsByCampaignIdsResult =
  | { success: true; counts: Record<string, number> }
  | { success: false; error: string }

/** Token (asset) counts per campaign for Campaigns and Fleet tabs. Same auth/scoping as Fleet list. */
export async function getTokenCountsByCampaignIds(
  campaignIds: string[],
  organizationId?: string | null
): Promise<GetTokenCountsByCampaignIdsResult> {
  try {
    const auth = await requireFleetAccess()
    if (!auth.ok) return { success: false, error: auth.error }

    const ids = (campaignIds ?? [])
      .filter((id): id is string => typeof id === 'string' && isUuidLike(String(id).trim()))
      .map((id) => String(id).trim())
      .slice(0, MAX_CAMPAIGN_IDS_FOR_COUNTS)
    if (ids.length === 0) return { success: true, counts: {} }

    const orgFilter =
      organizationId != null && String(organizationId).trim() !== ''
        ? String(organizationId).trim()
        : null
    if (orgFilter != null && !isUuidLike(orgFilter)) {
      return { success: false, error: 'Invalid organization filter.' }
    }

    const supabase = await createServerSupabase()
    const counts: Record<string, number> = {}

    const { data: rpcRows, error: rpcError } = await supabase.rpc('get_token_counts_by_campaigns', {
      p_campaign_ids: ids,
    })
    if (!rpcError && Array.isArray(rpcRows)) {
      for (const row of rpcRows as { campaign_id: string; token_count: number | string }[]) {
        const cid = row?.campaign_id
        const raw = row?.token_count
        const n = typeof raw === 'number' ? raw : Number(raw)
        if (cid && !Number.isNaN(n) && n >= 0) {
          counts[String(cid)] = Math.min(Math.floor(n), MAX_TOKENS_DESIGN)
        }
      }
      return { success: true, counts }
    }

    for (const campaignId of ids) {
      counts[campaignId] = 0
    }
    await Promise.all(
      ids.map(async (campaignId) => {
        let q = supabase
          .from('tokens')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
        if (auth.organizationId != null) {
          q = q.eq('organization_id', auth.organizationId)
        } else if (orgFilter != null) {
          q = q.eq('organization_id', orgFilter)
        }
        const { count, error } = await q
        if (!error && typeof count === 'number' && count >= 0) {
          counts[campaignId] = Math.min(count, MAX_TOKENS_DESIGN)
        }
      })
    )
    return { success: true, counts }
  } catch {
    return { success: false, error: 'Failed to load asset counts.' }
  }
}

// ---------------------------------------------------------------------------
// List (paginated)
// ---------------------------------------------------------------------------

export type FleetOrderBy = 'id' | 'status' | 'balance' | 'created_at'
export type FleetOrderDir = 'asc' | 'desc'

export type ListTokensInput = {
  page: number
  pageSize: number
  organizationId?: string | null
  campaignId?: string | null
  status?: TokenStatus
  searchQuery?: string
  orderBy?: FleetOrderBy
  orderDir?: FleetOrderDir
}

export type ListTokensResult<T> =
  | { success: true; rows: T[]; total: number }
  | { success: false; error: string }

export async function listTokens<T = unknown>(input: ListTokensInput): Promise<ListTokensResult<T>> {
  try {
    if (!input || typeof input !== 'object') return { success: false, error: 'Failed to load tokens.' }
    const auth = await requireFleetAccess()
    if (!auth.ok) return { success: false, error: auth.error }

    const orgIdFilter = input.organizationId != null && String(input.organizationId).trim() !== '' ? String(input.organizationId).trim() : null
    const campaignIdFilter = input.campaignId != null && String(input.campaignId).trim() !== '' ? String(input.campaignId).trim() : null
    if (orgIdFilter != null && !isUuidLike(orgIdFilter)) {
      return { success: false, error: 'Invalid organization filter.' }
    }
    if (campaignIdFilter != null && !isUuidLike(campaignIdFilter)) {
      return { success: false, error: 'Invalid campaign filter.' }
    }

    const pageSize = clampInt(input.pageSize, { min: 10, max: 200, fallback: 50 })
    const maxPage = Math.max(1, Math.ceil(MAX_TOKENS_DESIGN / pageSize))
    const page = Math.min(clampInt(input.page, { min: 1, max: MAX_PAGE, fallback: 1 }), maxPage)
    const q = String(input.searchQuery ?? '').trim().slice(0, 500)
    const searchByUuid = !!q && isUuidLike(q)
    const from = searchByUuid ? 0 : (page - 1) * pageSize
    const to = searchByUuid ? 0 : from + pageSize - 1

    const supabase = await createServerSupabase()
    let query = supabase
      .from('tokens')
      .select('*, campaigns(name), organizations(name)', { count: 'exact' })

    if (auth.organizationId != null) {
      query = query.eq('organization_id', auth.organizationId)
    } else if (orgIdFilter != null) {
      query = query.eq('organization_id', orgIdFilter)
    }
    if (campaignIdFilter != null) {
      query = query.eq('campaign_id', campaignIdFilter)
    }
    if (input.status) {
      query = query.eq('status', input.status)
    }
    if (q) {
      if (searchByUuid) {
        query = query.eq('id', q.toLowerCase())
      } else {
        // Non-UUID search: return no rows so UI shows empty (no partial/ILIKE for security)
        query = query.eq('id', '00000000-0000-0000-0000-000000000000')
      }
    }

    const orderBy = input.orderBy === 'status' || input.orderBy === 'balance' || input.orderBy === 'created_at' ? input.orderBy : 'id'
    const orderDir = input.orderDir === 'desc' ? 'desc' : 'asc'
    const { data, error, count } = await query
      .order(orderBy, { ascending: orderDir === 'asc' })
      .range(from, to)

    if (error) return { success: false, error: 'Failed to load tokens.' }
    const rows = Array.isArray(data) ? data : []
    // Normalize status so Fleet UI and counts always agree (6-state)
    const normalizedRows = rows.map((row: Record<string, unknown>) => ({
      ...row,
      status: normalizeTokenStatus(row.status),
    }))
    const rawTotal = count ?? 0
    const total =
      typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0
        ? Math.min(Math.floor(rawTotal), MAX_TOKENS_DESIGN)
        : 0
    return { success: true, rows: normalizedRows as T[], total }
  } catch {
    return { success: false, error: 'Failed to load tokens.' }
  }
}

// ---------------------------------------------------------------------------
// Get single token (for Fleet asset detail page)
// ---------------------------------------------------------------------------

export type GetTokenResult =
  | { success: true; token: FleetTokenDetail }
  | { success: false; error: string }

/** Single token by ID. Same auth/scoping as Fleet list; for asset detail page. */
export async function getToken(tokenId: string): Promise<GetTokenResult> {
  try {
    const auth = await requireFleetAccess()
    if (!auth.ok) return { success: false, error: auth.error }

    const id = typeof tokenId === 'string' ? String(tokenId).trim().toLowerCase() : ''
    if (!id || !isUuidLike(id)) {
      return { success: false, error: 'Invalid token ID.' }
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('tokens')
      .select('id, lat, lng, status, organization_id, campaign_id, balance, created_at, redeemed_at, reloaded_at, nfc_uid, asset_uuid, yield_source_id, campaigns(name), organizations(name)')
      .eq('id', id)
      .maybeSingle()

    if (error) return { success: false, error: 'Failed to load token.' }
    if (!data) return { success: false, error: 'Token not found.' }

    if (auth.organizationId != null) {
      const rowOrg = (data as { organization_id?: string | null }).organization_id
      const rowOrgNorm = String(rowOrg ?? '').trim().toLowerCase()
      const authOrgNorm = String(auth.organizationId ?? '').trim().toLowerCase()
      if (rowOrgNorm !== authOrgNorm) {
        return { success: false, error: 'Token not found.' }
      }
    }

    const row = data as { id: string; lat: number; lng: number; status: string; organization_id?: string | null; campaign_id?: string | null; balance?: number | null; created_at?: string | null; redeemed_at?: string | null; reloaded_at?: string | null; nfc_uid?: string | null; asset_uuid?: string | null; yield_source_id?: string | null; campaigns?: { name: string } | { name: string }[] | null; organizations?: { name: string } | { name: string }[] | null }
    let redeemer: { first_name: string; last_name: string; student_email: string; student_id: string } | null = null
    let first_redeemer: { first_name: string; last_name: string; student_email: string; student_id: string } | null = null
    if (row.status === 'REDEEMED') {
      const { data: responseRow } = await supabase
        .from('responses')
        .select('first_name, last_name, student_email, student_id')
        .eq('token_id', row.id)
        .maybeSingle()
      if (responseRow && typeof responseRow === 'object') {
        const r = responseRow as { first_name?: string | null; last_name?: string | null; student_email?: string | null; student_id?: string | null }
        redeemer = {
          first_name: String(r.first_name ?? '').trim(),
          last_name: String(r.last_name ?? '').trim(),
          student_email: String(r.student_email ?? '').trim(),
          student_id: String(r.student_id ?? '').trim(),
        }
      }
    } else {
      // When status is ACTIVE/DORMANT (e.g. after reload), still show who first redeemed (from responses).
      const { data: firstRow } = await supabase
        .from('responses')
        .select('first_name, last_name, student_email, student_id')
        .eq('token_id', row.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (firstRow && typeof firstRow === 'object') {
        const r = firstRow as { first_name?: string | null; last_name?: string | null; student_email?: string | null; student_id?: string | null }
        first_redeemer = {
          first_name: String(r.first_name ?? '').trim(),
          last_name: String(r.last_name ?? '').trim(),
          student_email: String(r.student_email ?? '').trim(),
          student_id: String(r.student_id ?? '').trim(),
        }
      }
    }
    const token = {
      id: row.id,
      lat: Number(row.lat) ?? 0,
      lng: Number(row.lng) ?? 0,
      status: normalizeTokenStatus(row.status),
      organization_id: row.organization_id ?? null,
      campaign_id: row.campaign_id ?? null,
      balance: row.balance != null ? Number(row.balance) : undefined,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      redeemed_at: typeof row.redeemed_at === 'string' ? row.redeemed_at : null,
      reloaded_at: typeof row.reloaded_at === 'string' ? row.reloaded_at : null,
      nfc_uid: row.nfc_uid ?? null,
      asset_uuid: row.asset_uuid ?? null,
      yield_source_id: row.yield_source_id ?? null,
      campaigns: Array.isArray(row.campaigns) ? row.campaigns[0] ?? null : row.campaigns ?? null,
      organizations: Array.isArray(row.organizations) ? row.organizations[0] ?? null : row.organizations ?? null,
      ...(auth.organizationId === null ? { claim_url: getClaimUrl(row.id) } : { claim_url_restricted: true }),
      ...(redeemer ? { redeemer } : {}),
      ...(first_redeemer ? { first_redeemer } : {}),
    }
    return { success: true, token }
  } catch {
    return { success: false, error: 'Failed to load token.' }
  }
}

// ---------------------------------------------------------------------------
// Assign campaign
// ---------------------------------------------------------------------------

export type AssignTokensToCampaignResult =
  | { success: true; count: number }
  | { success: false; error: string }

export async function assignTokensToCampaign(
  tokenIds: string[],
  campaignId: string | null
): Promise<AssignTokensToCampaignResult> {
  try {
    const auth = await requireFleetAccess()
    if (!auth.ok) return { success: false, error: auth.error }

    // Normalize unassign: null, empty, or "__unassign__" → null
    const rawCampaign = campaignId != null ? String(campaignId).trim() : ''
    const effectiveCampaignId =
      rawCampaign === '' || rawCampaign.toLowerCase() === '__unassign__'
        ? null
        : rawCampaign
    if (effectiveCampaignId != null && !isUuidLike(effectiveCampaignId)) {
      return { success: false, error: 'Invalid campaign ID.' }
    }

    const ids = [...new Set(
      (tokenIds ?? [])
        .filter((id) => typeof id === 'string' && isUuidLike(String(id).trim()))
        .map((id) => String(id).trim())
    )]
    if (ids.length === 0) return { success: false, error: 'No valid token IDs.' }
    if (ids.length > BATCH_LIMIT) {
      return { success: false, error: `Maximum ${BATCH_LIMIT} tokens per batch.` }
    }

    if (auth.organizationId != null) {
      const supabaseCheck = await createServerSupabase()
      const { data: tokens } = await supabaseCheck
        .from('tokens')
        .select('id')
        .in('id', ids)
        .eq('organization_id', auth.organizationId)
      const allowedIds = (tokens ?? []).map((t: { id: string }) => t.id)
      if (allowedIds.length !== ids.length) {
        return { success: false, error: 'Some tokens are not in your organization.' }
      }
    }

    const supabaseService = getSupabaseService()
    if (!supabaseService) return { success: false, error: 'Server configuration error.' }

    const updatePayload = { campaign_id: effectiveCampaignId }
    // Supabase generated types may not allow update on tokens; runtime is correct.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseService as any)
      .from('tokens')
      .update(updatePayload)
      .in('id', ids)

    if (error) return { success: false, error: error.message ?? 'Update failed.' }

    const supabaseAuth = await createServerSupabase()
    await logFleetAudit(supabaseAuth, 'campaign_assigned', auth.userId, {
      token_ids: ids,
      campaign_id: effectiveCampaignId,
      count: ids.length,
    })
    return { success: true, count: ids.length }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Assignment failed.' }
  }
}

// ---------------------------------------------------------------------------
// Transfer fleet (bulk assign to school)
// ---------------------------------------------------------------------------

export async function bulkAssignTokensToSchool(
  tokenIds: string[],
  organizationId: string
): Promise<BulkAssignToSchoolResult> {
  if (!tokenIds?.length || !organizationId?.trim()) {
    return { success: false, error: 'Select at least one token and a school.' }
  }
  if (!isUuidLike(organizationId.trim())) {
    return { success: false, error: 'Invalid organization ID.' }
  }
  try {
    const supabaseAuth = await createServerSupabase()
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated.' }

    const { data: profile } = await supabaseAuth
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    const role = (profile as { role?: string } | null)?.role
    if (role !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only SUPER_ADMIN can assign tokens to schools.' }
    }

    const ids = [...new Set(
      tokenIds
        .filter((id) => typeof id === 'string' && isUuidLike(String(id).trim()))
        .map((id) => String(id).trim())
    )]
    if (ids.length === 0) return { success: false, error: 'No valid token IDs.' }
    if (ids.length > BATCH_LIMIT) {
      return { success: false, error: `Maximum ${BATCH_LIMIT} tokens per batch.` }
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    // Block transfer when any token has balance > 0 (invariant: zero balances first).
    const { data: tokensWithBalance } = await supabase
      .from('tokens')
      .select('id, balance')
      .in('id', ids)
    const withBalance = (tokensWithBalance ?? []).filter(
      (t: { id: string; balance?: number | null }) => t.balance != null && Number(t.balance) > 0
    )
    if (withBalance.length > 0) {
      return {
        success: false,
        error: 'Cannot transfer tokens with balance > 0. Zero balances first.',
      }
    }

    // Supabase generated types may not allow update on tokens; runtime is correct.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('tokens')
      .update({ organization_id: organizationId.trim() })
      .in('id', ids)

    if (error) return { success: false, error: error.message ?? 'Update failed.' }

    await logFleetAudit(supabaseAuth, 'organization_assigned', user.id, {
      token_ids: ids,
      organization_id: organizationId.trim(),
      count: ids.length,
    })
    return { success: true, count: ids.length }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Assignment failed.' }
  }
}

// ---------------------------------------------------------------------------
// Export claim URLs
// ---------------------------------------------------------------------------

export type ExportClaimUrlsResult =
  | { success: true; csv: string }
  | { success: false; error: string }

export async function exportClaimUrls(
  tokenIds: string[],
  scope?: { campaignId?: string; organizationId?: string }
): Promise<ExportClaimUrlsResult> {
  try {
    const auth = await requireFleetAccess()
    if (!auth.ok) return { success: false, error: auth.error }

    const ids = [...new Set(
      (tokenIds ?? [])
        .filter((id) => typeof id === 'string' && isUuidLike(String(id).trim()))
        .map((id) => String(id).trim())
    )]
    if (ids.length === 0) return { success: false, error: 'No valid token IDs.' }
    if (ids.length > BATCH_LIMIT) {
      return { success: false, error: `Maximum ${BATCH_LIMIT} tokens per export.` }
    }

    if (auth.organizationId != null) {
      const supabaseCheck = await createServerSupabase()
      const { data: tokens } = await supabaseCheck
        .from('tokens')
        .select('id')
        .in('id', ids)
        .eq('organization_id', auth.organizationId)
      const allowedIds = (tokens ?? []).map((t: { id: string }) => t.id)
      if (allowedIds.length !== ids.length) {
        return { success: false, error: 'Some tokens are not in your organization.' }
      }
    }

    const supabase = await createServerSupabase()
    const { data: rows, error } = await supabase
      .from('tokens')
      .select('id, campaign_id, organization_id, campaigns(name), organizations(name)')
      .in('id', ids)

    if (error || !rows?.length) {
      return { success: false, error: 'Failed to load tokens for export.' }
    }
    if (rows.length !== ids.length) {
      return { success: false, error: 'Some tokens could not be loaded for export.' }
    }

    // Only SUPER_ADMIN gets full claim URLs; ORG_ADMIN gets redacted to prevent fraud
    const isSuperAdmin = auth.organizationId == null
    const header = 'token_id,claim_url,campaign_name,organization_name'
    type Row = { id: string; campaign_id?: string | null; organization_id?: string | null; campaigns?: { name: string } | { name: string }[] | null; organizations?: { name: string } | { name: string }[] | null }
    const lines = (rows as unknown as Row[]).map((r) => {
      const url = isSuperAdmin ? getClaimUrl(r.id) : '(restricted)'
      const campaignName = Array.isArray(r.campaigns) ? r.campaigns[0]?.name : r.campaigns?.name
      const orgName = Array.isArray(r.organizations) ? r.organizations[0]?.name : r.organizations?.name
      return `${escapeCsv(r.id)},${escapeCsv(url)},${escapeCsv(campaignName ?? '')},${escapeCsv(orgName ?? '')}`
    })
    const csv = [header, ...lines].join('\n')

    await logFleetAudit(supabase, 'urls_exported', auth.userId, {
      count: ids.length,
      export_scope: scope ? JSON.stringify(scope) : undefined,
    })
    return { success: true, csv }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Export failed.' }
  }
}

function escapeCsv(s: string): string {
  if (!/[\n,"]/.test(s)) return s
  return `"${s.replace(/"/g, '""')}"`
}

// ---------------------------------------------------------------------------
// Fleet audit log (Recent activity)
// ---------------------------------------------------------------------------

export type FleetAuditLogEvent = {
  event_type: string
  at: string
  actor_user_id: string | null
  payload?: Record<string, unknown> | null
}

export async function getFleetAuditLog(
  limit = 20
): Promise<
  { success: true; events: FleetAuditLogEvent[] } | { success: false; error: string }
> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const supabase = await createServerSupabase()
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
    const { data, error } = await supabase
      .from('fleet_audit_log')
      .select('event_type, at, actor_user_id, payload')
      .order('at', { ascending: false })
      .limit(safeLimit)

    if (error) return { success: false, error: 'Failed to load audit log.' }
    const rows = Array.isArray(data) ? data : []
    const events: FleetAuditLogEvent[] = rows.map((row: { event_type?: string; at?: string; actor_user_id?: string | null; payload?: Record<string, unknown> | null }) => ({
      event_type: typeof row.event_type === 'string' ? row.event_type : '—',
      at: typeof row.at === 'string' ? row.at : new Date().toISOString(),
      actor_user_id: row.actor_user_id ?? null,
      payload: row.payload ?? null,
    }))
    return { success: true, events }
  } catch {
    return { success: false, error: 'Failed to load audit log.' }
  }
}
