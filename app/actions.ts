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

// 1. STRICT VALIDATION & HELPERS
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}

/**
 * Normalizes a token ID from URL params or form input.
 * Handles URL encoding, whitespace, and extracts UUID pattern.
 * 
 * NOTE: This function behaves identically in production and local environments.
 * The regex pattern extraction is deterministic and does not depend on environment variables.
 */
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
  if (!url || !key) {
    console.error('[getSupabaseAnon] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
    return null
  }
  return createClient(url, key)
}

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('[getSupabaseService] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return null
  }
  return createClient(url, key)
}

function hasServiceRoleKey(): boolean {
  return !!SERVICE_ROLE_KEY
}

// 2. CORE ACTIONS

export async function claimToken(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (!isValidUUID(id)) return { success: false, error: 'Invalid Token ID format.' }

    const supabase = getSupabaseAnon()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const { data, error } = await supabase
      .from('tokens')
      .update({ status: 'found' })
      .eq('id', id)
      .select()
    if (error) {
      console.error('[claimToken] DB error:', error.message)
      return { success: false, error: 'Claim failed.' }
    }
    if (!data?.length) return { success: false, error: 'Token ID not found.' }
    return { success: true }
  } catch (err) {
    console.error('[claimToken] Unexpected error:', err)
    return { success: false, error: 'Claim failed.' }
  }
}

export async function resetDemo(
  orgId?: string | null
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const supabase = await createServerSupabase()
    let query = supabase
      .from('tokens')
      .update({ status: 'active' })
      .neq('status', 'active')
    if (orgId != null) query = query.eq('organization_id', orgId)
    const { error } = await query
    if (error) {
      console.error('[resetDemo] DB error:', error.message)
      return { success: false, error: error.message ?? 'Reset failed.' }
    }
    return { success: true }
  } catch (err) {
    console.error('[resetDemo] Unexpected error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Reset failed.' }
  }
}

// Types moved to lib/actions-constants.ts

export async function submitClaim(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  // LOG: Confirm function is being called
  console.log('[submitClaim] 🚀 Function invoked:', {
    tokenId: input.tokenId?.slice(0, 8) + '...',
    campaignId: input.campaignId ? input.campaignId.slice(0, 8) + '...' : 'null',
    studentEmail: input.studentEmail,
    timestamp: new Date().toISOString(),
  })

  // ENVIRONMENT CHECK: Fail fast with explicit error if Service Role Key is missing
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey) {
    console.error('[submitClaim] ❌ MISSING SUPABASE_SERVICE_ROLE_KEY in production environment')
    return { success: false, error: 'Server Error: Missing Service Role Key' }
  }
  if (!supabaseUrl) {
    console.error('[submitClaim] ❌ MISSING NEXT_PUBLIC_SUPABASE_URL in production environment')
    return { success: false, error: 'Server Error: Missing Supabase URL' }
  }

  try {
    const tokenId = normalizeClaimTokenId(input.tokenId)
    // SAFETY: Fail fast before ANY Supabase call
    if (!tokenId || !isValidUUID(tokenId)) {
      console.error('[submitClaim] Invalid token ID format:', { tokenId, raw: input.tokenId })
      return { success: false, error: 'Invalid Token ID format.' }
    }
    
    const supabase = getSupabaseService()
    if (!supabase) {
      console.error('[submitClaim] ❌ getSupabaseService() returned null. Check env vars:', {
        hasUrl: !!supabaseUrl,
        hasKey: !!serviceRoleKey,
        keyLength: serviceRoleKey?.length ?? 0,
      })
      return { success: false, error: 'Server Error: Missing Service Role Key' }
    }

    const { campaignId, firstName, lastName, studentId, studentEmail, venmoUsername, customAnswers, lat, lng, claimMetadata: clientMetadata } = input

    try {
      const { data: token, error: tokenErr } = await supabase
        .from('tokens')
        .select('id, organization_id')
        .eq('id', tokenId)
        .maybeSingle()

      if (tokenErr) {
        console.error('[submitClaim] ❌ Token lookup error:', {
          message: tokenErr.message,
          details: tokenErr.details,
          hint: tokenErr.hint,
          code: tokenErr.code,
          tokenId,
        })
        return { success: false, error: 'Token lookup failed.' }
      }
      if (!token) return { success: false, error: 'Token not found.' }

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

      if (insertErr) {
        console.error('[submitClaim] ❌ Response insert error:', {
          message: insertErr.message,
          details: insertErr.details,
          hint: insertErr.hint,
          code: insertErr.code,
          tokenId,
          campaignId,
        })
        return { success: false, error: 'Could not save response.' }
      }

      const tokenUpdate: Record<string, unknown> = { status: 'found' }
      if (lat != null && lng != null) {
        tokenUpdate.lat = lat
        tokenUpdate.lng = lng
      }

      const { error: updateErr } = await supabase
        .from('tokens')
        .update(tokenUpdate)
        .eq('id', tokenId)

      if (updateErr) {
        console.error('[submitClaim] token update error:', updateErr.message)
        return { success: false, error: 'Could not update token.' }
      }

      return { success: true }
    } catch (err) {
      console.error('[submitClaim] ❌ DB exception (inner catch):', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        name: err instanceof Error ? err.name : typeof err,
        tokenId: input.tokenId,
      })
      return { success: false, error: 'Something went wrong.' }
    }
  } catch (err) {
    console.error('[submitClaim] ❌ Unexpected error (outer catch):', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      name: err instanceof Error ? err.name : typeof err,
      input: {
        tokenId: input.tokenId,
        campaignId: input.campaignId,
        studentEmail: input.studentEmail,
      },
    })
    return { success: false, error: 'Something went wrong.' }
  }
}

export async function getTokenForClaim(tokenId: string) {
  try {
    const id = normalizeClaimTokenId(tokenId)
    // SAFETY: Fail fast before ANY Supabase call
    if (!id || !isValidUUID(id)) return null
    if (!hasServiceRoleKey()) return null
    const supabase = getSupabaseService()
    if (!supabase) return null

    try {
      const { data: token, error: tokenErr } = await supabase
        .from('tokens')
        .select('id, campaign_id')
        .eq('id', id)
        .maybeSingle()
      if (tokenErr) {
        console.error('[getTokenForClaim] token lookup error:', tokenErr.message)
        return null
      }
      if (!token) return null

      const campaignId = token.campaign_id
      let campaign: unknown = null
      if (campaignId) {
        // Use maybeSingle() so missing campaign doesn't throw
        const { data: camp, error: campErr } = await supabase
          .from('campaigns')
          .select('*')
          .eq('id', campaignId)
          .maybeSingle()
        if (campErr) {
          console.error('[getTokenForClaim] campaign lookup error:', campErr.message)
          campaign = null
        } else {
          campaign = camp ?? null
        }
      }

      return { token: { id: token.id, campaign_id: campaignId }, campaign }
    } catch (err) {
      console.error('[getTokenForClaim] DB exception:', err)
      return null
    }
  } catch {
    return null
  }
}

// 3. ADMIN FUNCTIONS

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
    if (!supabase) return { success: false, error: 'Server configuration error.' }
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
    if (!supabase) return { success: false, error: 'Server configuration error.' }
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
