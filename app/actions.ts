'use server'

import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase-server'

// STRICT REGEX
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

function normalizeClaimTokenId(raw: string): string {
  let s = String(raw ?? '')
  try { s = decodeURIComponent(s) } catch {}
  s = s.replace(/%20/g, '').replace(/\s+/g, ' ').trim()
  const uuidMatch = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
  if (uuidMatch) return uuidMatch[0].toLowerCase()
  return s
}

function getSupabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error("Missing Supabase API Keys on Server")
  return createClient(url, key)
}

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key)
}

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
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error("Token ID not found")
  return { success: true }
}

export async function resetDemo(orgId?: string | null) {
  const supabase = await createServerSupabase()
  let query = supabase.from('tokens').update({ status: 'active' }).neq('status', 'active')
  if (orgId != null) query = query.eq('organization_id', orgId)
  const { error } = await query
  if (error) throw new Error(error?.message ?? 'Reset failed')
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
  claimMetadata?: Record<string, unknown> | null
}

export type SubmitClaimResult = { success: true } | { success: false; error: string }

export async function submitClaim(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  if (!hasServiceRoleKey()) return { success: false, error: 'Server configuration error.' }
  
  try {
    const supabase = getSupabaseService()
    const tokenId = normalizeClaimTokenId(input.tokenId)

    // FAIL FAST VALIDATION
    if (!tokenId || !isValidUUID(tokenId)) {
      return { success: false, error: 'Invalid Token ID format.' }
    }

    const { campaignId, firstName, lastName, studentId, studentEmail, venmoUsername, customAnswers, lat, lng, claimMetadata: clientMetadata } = input

    const { data: token, error: tokenErr } = await supabase
      .from('tokens')
      .select('id, organization_id')
      .eq('id', tokenId)
      .maybeSingle()

    if (tokenErr || !token) return { success: false, error: 'Token not found.' }

    const orgId = (token as { organization_id?: string | null }).organization_id ?? null

    const claim_metadata: Record<string, unknown> = {
      ...(typeof clientMetadata === 'object' ? clientMetadata : {}),
      _submitted_at: new Date().toISOString(),
    }

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
      claim_metadata,
    })

    if (insertErr) return { success: false, error: 'Could not save response.' }

    const tokenUpdate: any = { status: 'found' }
    if (lat != null && lng != null) { tokenUpdate.lat = lat; tokenUpdate.lng = lng; }

    const { error: updateErr } = await supabase.from('tokens').update(tokenUpdate).eq('id', tokenId)

    if (updateErr) return { success: false, error: 'Could not update token.' }

    return { success: true }
  } catch (err) {
    console.error('submitClaim error:', err)
    return { success: false, error: 'Something went wrong.' }
  }
}

// ... getTokenForClaim (safe version) and other exports below ...
// Ensure you keep other exports like bulkAssignTokensToSchool, etc.
// Just paste this strict validation logic at the top!
export async function getTokenForClaim(tokenId: string) {
  if (!hasServiceRoleKey()) return null
  try {
    const supabase = getSupabaseService()
    const id = normalizeClaimTokenId(tokenId)
    if (!id || !isValidUUID(id)) return null // Strict check here too

    const { data: token } = await supabase.from('tokens').select('id, campaign_id').eq('id', id).maybeSingle()
    if (!token) return null

    // ... rest of logic
    return { token: { id: token.id, campaign_id: token.campaign_id }, campaign: null }
  } catch {
    return null
  }
}

export type BulkAssignToSchoolResult = { success: true; count: number } | { success: false; error: string }

export async function bulkAssignTokensToSchool(tokenIds: string[], organizationId: string): Promise<BulkAssignToSchoolResult> {
    // Placeholder to keep valid TS, ensure your original logic remains
    return { success: false, error: "Implemented in full file" }
}

export async function getRolePermissions() { return [] }
export async function setRolePermission() { return { success: false } }