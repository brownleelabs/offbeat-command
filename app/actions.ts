'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase-server'

/** Server client with no user – RLS may block writes. Prefer createServerSupabase() for authenticated flows. */
function getSupabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error("Missing Supabase API Keys on Server")
  return createClient(url, key)
}

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/** Service-role client (bypasses RLS). Use only for trusted server-only flows (e.g. anonymous claim). */
function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('[claim] SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local and restart the dev server.')
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for claim flow")
  }
  return createClient(url, key)
}

/** Call before claim flows – returns false if service role key is missing (so we can log clearly). */
function hasServiceRoleKey(): boolean {
  return !!SERVICE_ROLE_KEY
}

export async function claimToken(id: string) {
  const supabase = getSupabaseAnon()
  const { data, error } = await supabase
    .from('tokens')
    .update({ status: 'found' })
    .eq('id', id)
    .select()
  if (error) {
    console.error("ClaimToken Error:", error)
    throw new Error(error.message)
  }
  if (!data?.length) throw new Error("Token ID not found in database")
  return { success: true }
}

/** Reset tokens to active. Uses authenticated server client so RLS allows update for your org. */
export async function resetDemo(orgId?: string | null) {
  const supabase = await createServerSupabase()
  let query = supabase
    .from('tokens')
    .update({ status: 'active' })
    .neq('status', 'active')
  if (orgId != null) {
    query = query.eq('organization_id', orgId)
  }
  const { error } = await query
  if (error) {
    console.error('resetDemo:', error)
    throw new Error(error?.message ?? 'Reset failed')
  }
}

export type SubmitClaimInput = {
  tokenId: string
  campaignId: string | null
  firstName: string
  lastName: string
  studentId: string
  studentEmail: string
  venmoUsername: string
  customAnswers: { order: number; text: string; answer: string }[]
  lat?: number | null
  lng?: number | null
}

const UUID_REGEX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/

/** Normalize claim token ID from URL: decode, strip junk, extract UUID if present. */
function normalizeClaimTokenId(raw: string): string {
  let s = String(raw ?? '')
  try {
    s = decodeURIComponent(s)
  } catch {
    // leave as-is if decoding fails
  }
  s = s.replace(/%20/g, '').replace(/\s+/g, ' ').trim()
  const uuidMatch = s.match(UUID_REGEX)
  if (uuidMatch) return uuidMatch[0].toLowerCase()
  return s
}

/** Load token + campaign for claim page. Uses service role so anonymous users can open the claim form. Never throws – returns null on any error to avoid RSC digest leaks. */
export async function getTokenForClaim(tokenId: string) {
  if (!hasServiceRoleKey()) {
    console.error('[claim] getTokenForClaim: SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local and restart.')
    return null
  }
  try {
    const supabase = getSupabaseService()
    const id = normalizeClaimTokenId(tokenId)
    if (!id) return null

    const { data: token, error: tokenErr } = await supabase
      .from('tokens')
      .select('id, campaign_id')
      .eq('id', id)
      .maybeSingle()

    if (tokenErr) {
      console.warn('getTokenForClaim error:', tokenErr.code, tokenErr.message, 'id=', id)
      return null
    }
    if (!token) {
      console.warn('getTokenForClaim: no token for id=', id)
      return null
    }

    const campaignId = (token as { campaign_id: string | null }).campaign_id
    let campaign: unknown = null
    if (campaignId) {
      const { data: camp } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .single()
      campaign = camp
    }

    return { token: { id: (token as { id: string }).id, campaign_id: campaignId }, campaign }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('SERVICE_ROLE') || msg.includes('Missing')) {
      console.error('[claim] getTokenForClaim: SUPABASE_SERVICE_ROLE_KEY is missing or invalid. Add it to .env.local and restart.')
    } else {
      console.error('getTokenForClaim error:', err)
    }
    return null
  }
}

/** Result type for submitClaim – never throws, returns this instead. */
export type SubmitClaimResult = { success: true } | { success: false; error: string }

/** Submit claim form (anonymous). Uses service role. Never throws – returns result with success/error. */
export async function submitClaim(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  if (!hasServiceRoleKey()) {
    console.error('[claim] submitClaim: SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local and restart.')
    return { success: false, error: 'Something went wrong. Please try again later.' }
  }
  try {
    const supabase = getSupabaseService()
    const tokenId = normalizeClaimTokenId(input.tokenId)
    const { campaignId, firstName, lastName, studentId, studentEmail, venmoUsername, customAnswers, lat, lng } = input

    if (!tokenId) {
      return { success: false, error: 'Token ID is missing.' }
    }

    const { data: token, error: tokenErr } = await supabase
      .from('tokens')
      .select('id, organization_id')
      .eq('id', tokenId)
      .maybeSingle()

    if (tokenErr) {
      console.error('submitClaim token fetch:', tokenErr)
      return { success: false, error: 'Token not found.' }
    }
    if (!token) {
      return { success: false, error: 'Token not found.' }
    }

    const orgId = (token as { organization_id?: string | null }).organization_id ?? null

    const { error: insertErr } = await supabase.from('responses').insert({
      token_id: tokenId,
      campaign_id: campaignId ?? null,
      organization_id: orgId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      student_id: studentId.trim(),
      student_email: studentEmail.trim(),
      venmo_username: venmoUsername.trim(),
      custom_answers: Array.isArray(customAnswers) ? customAnswers : [],
    })

    if (insertErr) {
      console.error('submitClaim responses insert:', insertErr)
      return { success: false, error: insertErr.message || 'Could not save response.' }
    }

    const tokenUpdate: { status: 'found'; lat?: number; lng?: number } = { status: 'found' }
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      tokenUpdate.lat = lat
      tokenUpdate.lng = lng
    }

    const { error: updateErr } = await supabase
      .from('tokens')
      .update(tokenUpdate)
      .eq('id', tokenId)

    if (updateErr) {
      console.error('submitClaim token update:', updateErr)
      return { success: false, error: updateErr.message || 'Could not update token.' }
    }

    return { success: true }
  } catch (err) {
    console.error('submitClaim error:', err)
    const msg = err instanceof Error ? err.message : 'Submission failed.'
    const safe = msg.includes('SERVICE_ROLE') || msg.includes('Missing') ? 'Something went wrong. Please try again later.' : msg
    return { success: false, error: safe }
  }
}