'use server'

import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase-server'
import {
  type BulkAssignToSchoolResult,
  type SubmitClaimInput,
  type SubmitClaimResult,
} from '@/lib/actions-constants'
import {
  CONTROLLABLE_ROLES,
  ROLE_PERMISSION_KEYS,
  type RolePermissionKey,
  type RolePermissionRow,
} from '@/lib/constants'

// --- 1. STRICT VALIDATION & HELPERS ---
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

// --- 2. CORE ACTIONS (CLAIM & RESET) ---

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

// Types moved to lib/actions-constants.ts

export async function submitClaim(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  if (!hasServiceRoleKey()) return { success: false, error: 'Server configuration error.' }
  
  try {
    const supabase = getSupabaseService()
    const tokenId = normalizeClaimTokenId(input.tokenId)

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

    const serverHeaders: Record<string, string> = {}
    try {
      const h = await headers()
      const copy = (name: string) => {
        const v = h.get(name)
        if (v) serverHeaders[name.replace(/-/g, '_').toLowerCase()] = v
      }
      copy('user-agent')
      copy('x-forwarded-for')
      copy('x-real-ip')
    } catch {}

    const claim_metadata: Record<string, unknown> = {
      ...(typeof clientMetadata === 'object' ? clientMetadata : {}),
      _server: serverHeaders,
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

export async function getTokenForClaim(tokenId: string) {
  if (!hasServiceRoleKey()) return null
  try {
    const supabase = getSupabaseService()
    const id = normalizeClaimTokenId(tokenId)
    // FAIL FAST: If strict ID check fails, return null immediately
    if (!id || !isValidUUID(id)) return null

    const { data: token } = await supabase.from('tokens').select('id, campaign_id').eq('id', id).maybeSingle()
    if (!token) return null

    const campaignId = token.campaign_id
    let campaign: unknown = null
    if (campaignId) {
      const { data: camp } = await supabase.from('campaigns').select('*').eq('id', campaignId).single()
      campaign = camp
    }

    return { token: { id: token.id, campaign_id: campaignId }, campaign }
  } catch {
    return null
  }
}

// --- 3. ADMIN FUNCTIONS ---

export async function bulkAssignTokensToSchool(
  tokenIds: string[],
  organizationId: string
): Promise<BulkAssignToSchoolResult> {
  if (!tokenIds?.length || !organizationId?.trim()) {
    return { success: false, error: 'Select at least one token and a school.' }
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

    if (!hasServiceRoleKey()) {
      return { success: false, error: 'Server configuration error.' }
    }

    const supabase = getSupabaseService()
    const ids = tokenIds.filter((id) => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) return { success: false, error: 'No valid token IDs.' }

    const { error } = await supabase
      .from('tokens')
      .update({ organization_id: organizationId.trim() })
      .in('id', ids)

    if (error) {
      return { success: false, error: error.message ?? 'Update failed.' }
    }
    return { success: true, count: ids.length }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Assignment failed.' }
  }
}

// Constants and types moved to lib/actions-constants.ts

export async function getRolePermissions(): Promise<RolePermissionRow[]> {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('role_permissions')
      .select('role, permission_key, enabled')
    if (error) return []
    return (data ?? []) as RolePermissionRow[]
  } catch {
    return []
  }
}

export async function setRolePermission(
  role: string,
  permissionKey: string,
  enabled: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const supabaseAuth = await createServerSupabase()
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated.' }

    const { data: profile } = await supabaseAuth
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if ((profile as { role?: string } | null)?.role !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only SUPER_ADMIN can change role permissions.' }
    }

    if (!CONTROLLABLE_ROLES.includes(role as never) || !ROLE_PERMISSION_KEYS.includes(permissionKey as RolePermissionKey)) {
      return { success: false, error: 'Invalid role or permission key.' }
    }

    const supabase = getSupabaseService()
    const { error } = await supabase
      .from('role_permissions')
      .upsert({ role, permission_key: permissionKey, enabled, updated_at: new Date().toISOString() }, {
        onConflict: 'role,permission_key',
      })

    if (error) {
      return { success: false, error: error.message ?? 'Update failed.' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed.' }
  }
}