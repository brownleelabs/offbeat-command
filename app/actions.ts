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

/** Service-role client (bypasses RLS). Use only for trusted server-only flows (e.g. anonymous claim). */
function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for claim flow")
  return createClient(url, key)
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

/** Load token + campaign for claim page. Uses service role so anonymous users can open the claim form. Never throws – returns null on any error to avoid RSC digest leaks. */
export async function getTokenForClaim(tokenId: string) {
  try {
    const supabase = getSupabaseService()
    const id = tokenId.replace(/%20/g, '').trim()
    if (!id) return null

    const { data: token, error: tokenErr } = await supabase
      .from('tokens')
      .select('id, campaign_id')
      .eq('id', id)
      .single()

    if (tokenErr || !token) {
      console.warn('getTokenForClaim token:', tokenErr?.message)
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
    console.error('getTokenForClaim error:', err)
    return null
  }
}

/** Submit claim form (anonymous). Uses service role so unauthenticated students can claim. */
export async function submitClaim(input: SubmitClaimInput) {
  const supabase = getSupabaseService()
  const { tokenId, campaignId, firstName, lastName, studentId, studentEmail, venmoUsername, customAnswers, lat, lng } = input

  const { data: token, error: tokenErr } = await supabase
    .from('tokens')
    .select('id, organization_id')
    .eq('id', tokenId)
    .single()

  if (tokenErr || !token) {
    console.error('submitClaim token fetch:', tokenErr)
    throw new Error("Token not found.")
  }

  const orgId = (token as { organization_id?: string | null }).organization_id ?? null

  const { error: insertErr } = await supabase.from('responses').insert({
    token_id: tokenId,
    campaign_id: campaignId,
    organization_id: orgId,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    student_id: studentId.trim(),
    student_email: studentEmail.trim(),
    venmo_username: venmoUsername.trim(),
    custom_answers: customAnswers,
  })

  if (insertErr) {
    console.error('submitClaim responses insert:', insertErr)
    throw new Error(insertErr.message)
  }

  const tokenUpdate: { status: 'found'; lat?: number; lng?: number } = { status: 'found' }
  if (lat != null && lng != null) {
    tokenUpdate.lat = lat
    tokenUpdate.lng = lng
  }

  const { error: updateErr } = await supabase
    .from('tokens')
    .update(tokenUpdate)
    .eq('id', tokenId)

  if (updateErr) {
    console.error('submitClaim token update:', updateErr)
    throw new Error(updateErr.message)
  }

  return { success: true }
}