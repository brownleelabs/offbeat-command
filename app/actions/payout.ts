'use server'

/**
 * Fast Rail: Venmo payout then Burn rule (redemption_history + token → REDEEMED, balance 0).
 * Call after submitClaim has transitioned token to PENDING_SETTLEMENT and inserted response.
 */

import { getSupabaseService } from '@/lib/auth-server'
import { canTransition } from '@/lib/token-logic'
import type { TokenStatus } from '@/types'

const PAYOUT_AMOUNT_USD = 25

export type PayoutInput = {
  tokenId: string
  responseId?: string | null
  venmoUsername?: string | null
}

export type PayoutResult =
  | { success: true }
  | { success: false; error: string }

/**
 * Execute payout: verify token state, (stub) Venmo call, then Burn rule.
 */
export async function executePayout(input: PayoutInput): Promise<PayoutResult> {
  const { tokenId, responseId, venmoUsername } = input ?? {}
  const id = typeof tokenId === 'string' ? tokenId.trim().toLowerCase() : ''
  if (!id) return { success: false, error: 'Invalid token ID.' }

  const supabase = getSupabaseService()
  if (!supabase) return { success: false, error: 'Server configuration error.' }

  const { data: token, error: tokenErr } = await supabase
    .from('tokens')
    .select('id, status, asset_uuid, balance')
    .eq('id', id)
    .maybeSingle()

  if (tokenErr) return { success: false, error: 'Failed to load token.' }
  if (!token) return { success: false, error: 'Token not found.' }

  const status = (token as { status: string }).status as TokenStatus
  if (status !== 'PENDING_SETTLEMENT' && status !== 'ACTIVE') {
    return { success: false, error: 'Token is not in a state that can be paid out.' }
  }

  const assetUuid = (token as { asset_uuid?: string | null }).asset_uuid ?? null
  if (!assetUuid) return { success: false, error: 'Token has no asset to redeem.' }

  let responseIdResolved = responseId ?? null
  if (!responseIdResolved) {
    const { data: resp } = await supabase
      .from('responses')
      .select('id')
      .eq('token_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    responseIdResolved = (resp as { id?: string } | null)?.id ?? null
  }

  // Validate transition before any writes (avoid orphan redemption_history if transition invalid)
  const nextStatus: TokenStatus = 'REDEEMED'
  if (!canTransition(status, nextStatus)) {
    return { success: false, error: 'Invalid state transition for payout.' }
  }

  // Venmo/PayPal Payouts API: $25 to venmoUsername (VENMO_CLIENT_ID, VENMO_CLIENT_SECRET, VENMO_ENVIRONMENT)
  // Stub: when Venmo keys are configured, call API; for now succeed so Burn rule can run.
  const venmoHandle = typeof venmoUsername === 'string' ? venmoUsername.trim() : ''
  if (process.env.VENMO_CLIENT_ID && process.env.VENMO_CLIENT_SECRET && venmoHandle) {
    // TODO: call Venmo/PayPal Payouts API with PAYOUT_AMOUNT_USD and venmoHandle
    // On failure return { success: false, error: 'Payout failed.' }
  }

  // Burn rule: archive asset_uuid to redemption_history, set token to REDEEMED, balance 0, clear asset_uuid
  const redeemedAt = new Date().toISOString()
  const { error: histErr } = await (supabase as any).from('redemption_history').insert({
    token_id: id,
    asset_uuid: assetUuid,
    redeemed_at: redeemedAt,
    response_id: responseIdResolved,
  })
  if (histErr) {
    console.error('[payout] redemption_history insert error:', histErr)
    return { success: false, error: 'Failed to record redemption.' }
  }

  const { error: updateErr } = await (supabase as any)
    .from('tokens')
    .update({
      status: nextStatus,
      balance: 0,
      asset_uuid: null,
      redeemed_at: redeemedAt,
    })
    .eq('id', id)

  if (updateErr) {
    console.error('[payout] token update error:', updateErr)
    return { success: false, error: 'Failed to complete redemption.' }
  }

  return { success: true }
}
