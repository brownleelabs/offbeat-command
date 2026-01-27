'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase-server'
import {
  CONTROLLABLE_ROLES,
  ROLE_PERMISSION_KEYS,
  type BulkAssignToSchoolResult,
  type RolePermissionKey,
  type RolePermissionRow,
  type SubmitClaimInput,
} from '@/lib/actions-constants'

/** Server client with no user – RLS may block writes. Prefer createServerSupabase() for authenticated flows. Returns null if env vars missing. */
function getSupabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('[getSupabaseAnon] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
    return null
  }
  return createClient(url, key)
}

/** Service-role client (bypasses RLS). Use only for trusted server-only flows (e.g. anonymous claim). */
function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('[claim] SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local and restart.')
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for claim flow")
  }
  return createClient(url, key)
}

/** Call before claim flows – returns false if service role key is missing (so we can log clearly). */
function hasServiceRoleKey(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY
}

/** Claim a token (authenticated). Never throws – returns result with success/error. */
export async function claimToken(id: string): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const supabase = getSupabaseAnon()
    if (!supabase) {
      return { success: false, error: 'Server configuration error.' }
    }
    const { data, error } = await supabase
      .from('tokens')
      .update({ status: 'found' })
      .eq('id', id)
      .select()
    if (error) {
      console.error("ClaimToken Error:", error)
      return { success: false, error: error.message || 'Failed to claim token.' }
    }
    if (!data?.length) {
      return { success: false, error: 'Token ID not found in database' }
    }
    return { success: true }
  } catch (err) {
    console.error('claimToken error:', err)
    const msg = err instanceof Error ? err.message : 'Claim failed.'
    // Don't expose internal errors about missing env vars
    const safe = msg.includes('Missing Supabase') ? 'Server configuration error.' : msg
    return { success: false, error: safe }
  }
}

/** Reset tokens to active. Uses authenticated server client so RLS allows update for your org. Never throws – returns result with success/error. */
export async function resetDemo(orgId?: string | null): Promise<{ success: true } | { success: false; error: string }> {
  try {
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
      return { success: false, error: error?.message ?? 'Reset failed' }
    }
    return { success: true }
  } catch (err) {
    console.error('resetDemo error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Reset failed.' }
  }
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Normalize claim token ID from URL: decode, strip junk, extract UUID if present. */
function normalizeClaimTokenId(raw: string): string {
  let s = String(raw ?? '')
  try {
    s = decodeURIComponent(s)
  } catch {
    // leave as-is if decoding fails
  }
  s = s.replace(/%20/g, '').replace(/\s+/g, ' ').trim()
  // Extract UUID pattern (without anchors for extraction, but validate with anchors later)
  const uuidPattern = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/i
  const uuidMatch = s.match(uuidPattern)
  if (uuidMatch) return uuidMatch[0].toLowerCase()
  return s
}

/** Strict UUID validation - returns true only if the string is exactly a valid UUID. */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}

/** Load token + campaign for claim page. Uses service role. Returns full token (including status) and campaign (including deleted_at). Never throws – returns null on any error. */
export async function getTokenForClaim(tokenId: string) {
  if (!hasServiceRoleKey()) {
    console.error('[claim] getTokenForClaim: SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local and restart.')
    return null
  }
  try {
    const supabase = getSupabaseService()
    const id = normalizeClaimTokenId(tokenId)
    if (!id) return null

    // Strict UUID validation - must match exactly before querying Supabase
    if (!isValidUUID(id)) {
      console.error('[claim] getTokenForClaim: Invalid UUID format:', id)
      return null
    }

    const { data: token, error: tokenErr } = await supabase
      .from('tokens')
      .select('id, lat, lng, status, organization_id, campaign_id')
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

    const t = token as { id: string; lat?: number; lng?: number; status?: string; organization_id?: string | null; campaign_id?: string | null }
    const fullToken = {
      id: t.id,
      lat: Number(t.lat) || 0,
      lng: Number(t.lng) || 0,
      status: (t.status === 'found' ? 'found' : 'active') as 'active' | 'found',
      organization_id: t.organization_id ?? null,
    }

    const campaignId = t.campaign_id ?? null
    let campaign: unknown = null
    if (campaignId) {
      try {
        const { data: camp, error: campError } = await supabase
          .from('campaigns')
          .select('*')
          .eq('id', campaignId)
          .single()
        
        if (campError) {
          console.warn('getTokenForClaim campaign fetch error:', campError.code, campError.message)
          // Continue without campaign
        } else {
          campaign = camp
        }
      } catch (err) {
        console.error('getTokenForClaim campaign fetch exception:', err)
        // Continue without campaign
      }
    }

    return { token: fullToken, campaign }
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

/** Submit claim form (anonymous). Uses service role. Never throws – returns result with success/error. */
export async function submitClaim(input: SubmitClaimInput) {
  if (!hasServiceRoleKey()) {
    console.error('[claim] submitClaim: SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local and restart.')
    return { success: false, error: 'Something went wrong. Please try again later.' }
  }
  try {
    const supabase = getSupabaseService()
    const tokenId = normalizeClaimTokenId(input.tokenId)
    const { campaignId, firstName, lastName, studentId, studentEmail, venmoUsername, customAnswers, lat, lng, claimMetadata: clientMetadata } = input

    // SAFETY: Fail fast if ID is bad
    if (!tokenId || !isValidUUID(tokenId)) {
      return { success: false, error: 'Invalid Token ID format.' }
    }

    // Validate campaignId if provided
    if (campaignId && !isValidUUID(campaignId)) {
      console.error('[claim] submitClaim: Invalid campaign UUID format:', campaignId)
      return { success: false, error: 'Invalid campaign ID format.' }
    }

    const { data: token, error: tokenErr } = await supabase
      .from('tokens')
      .select('id, organization_id, status, campaign_id')
      .eq('id', tokenId)
      .maybeSingle()

    if (tokenErr) {
      console.error('submitClaim token fetch:', tokenErr)
      return { success: false, error: 'Token not found.' }
    }
    if (!token) {
      return { success: false, error: 'Token not found.' }
    }

    // Check if token is already claimed
    if ((token as { status?: string }).status === 'found') {
      return { success: false, error: 'This token has already been claimed.' }
    }

    const tokenCampaignId = (token as { campaign_id?: string | null }).campaign_id ?? null

    // SECURITY: Validate campaign exists, is not archived, and matches token's campaign_id
    if (campaignId) {
      // Verify campaignId matches token's campaign_id
      if (campaignId !== tokenCampaignId) {
        return { success: false, error: 'Campaign ID does not match the token assignment.' }
      }

      const { data: campaign, error: campaignErr } = await supabase
        .from('campaigns')
        .select('id, deleted_at')
        .eq('id', campaignId)
        .maybeSingle()

      if (campaignErr) {
        console.error('submitClaim campaign fetch:', campaignErr)
        return { success: false, error: 'Campaign not found.' }
      }

      if (!campaign) {
        return { success: false, error: 'Campaign not found.' }
      }

      // Block claims to archived campaigns
      if ((campaign as { deleted_at?: string | null }).deleted_at) {
        return { success: false, error: 'This campaign has ended. Submissions are no longer accepted.' }
      }
    } else if (tokenCampaignId) {
      // If no campaignId provided but token has one, that's also invalid
      return { success: false, error: 'This token requires a campaign ID.' }
    }

    const orgId = (token as { organization_id?: string | null }).organization_id ?? null

    // Merge client tap context; skip headers() in this action to avoid Server Components digest errors.
    const claim_metadata: Record<string, unknown> = {
      ...(typeof clientMetadata === 'object' && clientMetadata !== null ? clientMetadata : {}),
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


/** SUPER_ADMIN or ORG_ADMIN: bulk assign selected tokens to an organization. SUPER_ADMIN may pick any org; ORG_ADMIN is limited to their profile.organization_id. */
export async function bulkAssignTokensToSchool(
  tokenIds: string[],
  organizationId: string
): Promise<BulkAssignToSchoolResult> {
  if (!tokenIds?.length || !organizationId?.trim()) {
    return { success: false, error: 'Select at least one token and an organization.' }
  }
  try {
    const supabaseAuth = await createServerSupabase()
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated.' }

    const { data: profile, error: profileError } = await supabaseAuth
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      console.error('bulkAssignTokensToSchool profile fetch:', profileError)
      return { success: false, error: 'User profile not found.' }
    }

    const role = (profile as { role?: string; organization_id?: string | null }).role
    const profileOrgId = (profile as { organization_id?: string | null }).organization_id ?? null

    let effectiveOrgId: string
    if (role === 'SUPER_ADMIN') {
      effectiveOrgId = organizationId.trim()
    } else if (role === 'ORG_ADMIN' && profileOrgId) {
      if (organizationId.trim() !== profileOrgId) {
        return { success: false, error: 'You can only assign tokens to your own organization.' }
      }
      effectiveOrgId = profileOrgId
    } else {
      return { success: false, error: 'Only SUPER_ADMIN or ORG_ADMIN can assign tokens to organizations.' }
    }

    if (!hasServiceRoleKey()) {
      console.error('[bulkAssignTokensToSchool] SUPABASE_SERVICE_ROLE_KEY is missing.')
      return { success: false, error: 'Server configuration error.' }
    }

    const supabase = getSupabaseService()
    const ids = tokenIds.filter((id) => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) return { success: false, error: 'No valid token IDs.' }

    const { error } = await supabase
      .from('tokens')
      .update({ organization_id: effectiveOrgId })
      .in('id', ids)

    if (error) {
      console.error('bulkAssignTokensToSchool:', error)
      return { success: false, error: error.message ?? 'Update failed.' }
    }
    return { success: true, count: ids.length }
  } catch (err) {
    console.error('bulkAssignTokensToSchool error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Assignment failed.' }
  }
}

/** Fetch current role_permissions for UI. Authenticated users can read. */
export async function getRolePermissions(): Promise<RolePermissionRow[]> {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('role_permissions')
      .select('role, permission_key, enabled')
    if (error) {
      console.warn('getRolePermissions:', error.message)
      return []
    }
    return (data ?? []) as RolePermissionRow[]
  } catch {
    return []
  }
}

/** Set one permission toggle. SUPER_ADMIN only. */
export async function setRolePermission(
  role: string,
  permissionKey: string,
  enabled: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const supabaseAuth = await createServerSupabase()
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated.' }

    const { data: profile, error: profileError } = await supabaseAuth
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      console.error('setRolePermission profile fetch:', profileError)
      return { success: false, error: 'User profile not found.' }
    }

    if ((profile as { role?: string }).role !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only SUPER_ADMIN can change role permissions.' }
    }

    if (!CONTROLLABLE_ROLES.includes(role as never) || !ROLE_PERMISSION_KEYS.includes(permissionKey as RolePermissionKey)) {
      return { success: false, error: 'Invalid role or permission key.' }
    }

    if (!hasServiceRoleKey()) {
      return { success: false, error: 'Server configuration error.' }
    }

    const supabase = getSupabaseService()
    const { error } = await supabase
      .from('role_permissions')
      .upsert({ role, permission_key: permissionKey, enabled, updated_at: new Date().toISOString() }, {
        onConflict: 'role,permission_key',
      })

    if (error) {
      console.error('setRolePermission:', error)
      return { success: false, error: error.message ?? 'Update failed.' }
    }
    return { success: true }
  } catch (err) {
    console.error('setRolePermission error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Update failed.' }
  }
}
