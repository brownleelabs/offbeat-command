'use server'

import { headers } from 'next/headers'
import { Resend } from 'resend'
import { createServerSupabase } from '@/lib/supabase-server'
import { getSupabaseService, getSupabaseAnon, hasServiceRoleKey, requireProfile, requireSuperAdmin } from '@/lib/auth-server'
import { isUuid } from '@/lib/validation'
import {
  type SubmitClaimInput,
  type SubmitClaimResult,
} from '@/lib/actions-constants'
import { bulkAssignTokensToSchool } from '@/app/fleet/fleet-actions'
import {
  CONTROLLABLE_ROLES,
  ROLE_PERMISSION_KEYS,
  type RolePermissionKey,
  type RolePermissionRow,
} from '@/lib/constants'
import type { UserRole } from '@/types'

/** Alias for shared validation (used by claim, org, user actions). */
function isValidUUID(id: string): boolean {
  return isUuid(id)
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


// 2. CORE ACTIONS

export async function claimToken(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (!isValidUUID(id)) return { success: false, error: 'Invalid Token ID format.' }

    const supabase = getSupabaseAnon()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
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
    const profileResult = await requireProfile()
    if (!profileResult.ok) return { success: false, error: 'Not authenticated.' }
    const { role, organizationId: profileOrgId } = profileResult

    if (role === 'SUPER_ADMIN') {
      // Allow; scope by orgId when provided
    } else if (role === 'ORG_ADMIN') {
      const supabaseAuth = await createServerSupabase()
      const { data: perms } = await supabaseAuth
        .from('role_permissions')
        .select('enabled')
        .eq('role', 'ORG_ADMIN')
        .eq('permission_key', 'map_reset')
        .maybeSingle()
      if (!(perms as { enabled?: boolean } | null)?.enabled) {
        return { success: false, error: 'Not allowed.' }
      }
      // ORG_ADMIN may only reset their org's tokens; force scope to profile org
      if (profileOrgId != null && orgId != null && String(orgId).trim() !== String(profileOrgId).trim()) {
        return { success: false, error: 'Not allowed.' }
      }
    } else {
      return { success: false, error: 'Not allowed.' }
    }

    const supabase = await createServerSupabase()
    let query = supabase
      .from('tokens')
      .update({ status: 'active' })
      .neq('status', 'active')
    // SUPER_ADMIN: use orgId when provided; ORG_ADMIN: scope to their org
    const scopeOrgId = role === 'ORG_ADMIN' ? profileOrgId : orgId
    if (scopeOrgId != null) query = query.eq('organization_id', scopeOrgId)
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
  try {
    if (!input || typeof input !== 'object') {
      return { success: false, error: 'Invalid request.' }
    }
    const tokenId = normalizeClaimTokenId(input.tokenId)
    // SAFETY: Fail fast before ANY Supabase call
    if (!tokenId || !isValidUUID(tokenId)) {
      console.error('[submitClaim] Invalid token ID format:', { tokenId, raw: input.tokenId })
      return { success: false, error: 'Invalid Token ID format.' }
    }

    // Use SERVICE ROLE client so claims can be submitted without auth
    if (!hasServiceRoleKey()) {
      console.error('[submitClaim] ❌ Missing SUPABASE_SERVICE_ROLE_KEY')
      return { success: false, error: 'Server Error: Missing Service Role Key' }
    }
    const supabase = getSupabaseService()
    if (!supabase) {
      return { success: false, error: 'Server configuration error.' }
    }

      const { campaignId, firstName, lastName, studentId, studentEmail, venmoUsername, customAnswers, lat, lng, claimMetadata: clientMetadata } = input
      const campaignIdInput = typeof campaignId === 'string' ? campaignId.trim() : ''

    try {
      // Fetch token with org + campaign + balance to enforce business rules
      const { data: token, error: tokenErr } = await supabase
        .from('tokens')
        .select('id, organization_id, campaign_id, status, balance')
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
      if (!token) {
        return { success: false, error: 'Token not found.' }
      }

      // Block double-claims
      if ((token as { status?: string }).status === 'found') {
        return { success: false, error: 'This token has already been claimed.' }
      }

      // Block redemption when token has no value (balance $0 or null)
      const balanceRaw = (token as { balance?: number | null }).balance
      const balanceNum = balanceRaw != null ? Number(balanceRaw) : 0
      if (!Number.isFinite(balanceNum) || balanceNum <= 0) {
        return { success: false, error: 'This token has no value and cannot be redeemed.' }
      }

      // Enforce that token must be assigned to a campaign (valid UUID only; malformed DB data must not reach Supabase)
      const rawCampaignId = (token as { campaign_id?: unknown }).campaign_id
      const tokenCampaignId =
        typeof rawCampaignId === 'string' && rawCampaignId.trim().length > 0 ? rawCampaignId.trim() : ''
      if (!tokenCampaignId || !isValidUUID(tokenCampaignId)) {
        return { success: false, error: 'This asset is not currently active.' }
      }

      // Enforce that provided campaign matches token's campaign (case-insensitive UUID)
      if (!campaignIdInput || campaignIdInput.toLowerCase() !== tokenCampaignId.toLowerCase()) {
        return { success: false, error: 'Invalid campaign for this token.' }
      }

      // Validate campaign is active and not archived/deleted (only active campaigns accept claims)
      const { data: campaign, error: campErr } = await supabase
        .from('campaigns')
        .select('id, status, deleted_at, archived_at')
        .eq('id', tokenCampaignId)
        .maybeSingle()

      if (campErr) {
        console.error('[submitClaim] ❌ Campaign lookup error:', {
          message: campErr.message,
          details: campErr.details,
          hint: campErr.hint,
          code: campErr.code,
          campaignId: tokenCampaignId,
        })
        return { success: false, error: 'Campaign lookup failed.' }
      }
      if (!campaign) {
        return { success: false, error: 'Campaign not found.' }
      }
      const camp = campaign as { status?: string | null; deleted_at?: string | null; archived_at?: string | null }
      if (camp.deleted_at) {
        return { success: false, error: 'This campaign has ended.' }
      }
      if (camp.archived_at) {
        return { success: false, error: 'This campaign is not accepting claims.' }
      }
      if (camp.status !== 'active') {
        return { success: false, error: 'This campaign is not currently active.' }
      }

      // Duplicate claim: one reward per person per campaign (by student_email)
      const emailNorm = String(studentEmail ?? '').trim().toLowerCase()
      if (emailNorm) {
        const { data: existing } = await supabase
          .from('responses')
          .select('id')
          .eq('campaign_id', tokenCampaignId)
          .ilike('student_email', emailNorm)
          .limit(1)
        if (existing != null && existing.length > 0) {
          return { success: false, error: "You've already claimed a reward in this campaign." }
        }
      }

      const rawOrgId = (token as { organization_id?: unknown }).organization_id ?? null
      const orgId =
        rawOrgId != null &&
        typeof rawOrgId === 'string' &&
        rawOrgId.trim().length > 0 &&
        isValidUUID(rawOrgId.trim())
          ? rawOrgId.trim()
          : null

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
        ...(clientMetadata != null && typeof clientMetadata === 'object' ? clientMetadata : {}),
        _server: serverHeaders,
        _submitted_at: new Date().toISOString(),
      }

      let safeCustomAnswers: unknown[] = Array.isArray(customAnswers) ? customAnswers.slice(0, 20) : []
      try {
        JSON.stringify(safeCustomAnswers)
      } catch {
        safeCustomAnswers = []
      }
      let safeClaimMetadata: Record<string, unknown> = claim_metadata
      try {
        JSON.stringify(claim_metadata)
      } catch {
        safeClaimMetadata = { _server: serverHeaders, _submitted_at: new Date().toISOString() }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertErr } = await (supabase as any).from('responses').insert({
        token_id: tokenId,
        campaign_id: tokenCampaignId,
        organization_id: orgId,
        first_name: String(firstName ?? '').trim(),
        last_name: String(lastName ?? '').trim(),
        student_id: String(studentId ?? '').trim(),
        student_email: String(studentEmail ?? '').trim(),
        venmo_username: String(venmoUsername ?? '').trim(),
        custom_answers: safeCustomAnswers,
        claim_metadata: safeClaimMetadata,
      })

      if (insertErr) {
        // Unique constraint safety net: if a response already exists for this token, treat as already claimed.
        if ((insertErr as { code?: string } | null)?.code === '23505') {
          // Best-effort: ensure token status converges to "found" even if a prior claim failed mid-flight.
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('tokens').update({ status: 'found', redeemed_at: new Date().toISOString() }).eq('id', tokenId)
          } catch {}
          return { success: false, error: 'This token has already been claimed.' }
        }
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

      const tokenUpdate: Record<string, unknown> = { status: 'found', redeemed_at: new Date().toISOString() }
      if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        tokenUpdate.lat = lat
        tokenUpdate.lng = lng
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateErr } = await (supabase as any)
        .from('tokens')
        .update(tokenUpdate)
        .eq('id', tokenId)

      if (updateErr) {
        console.error('[submitClaim] token update error:', updateErr.message)
        // Best-effort: retry with minimal payload (status + redeemed_at) to reduce inconsistent states.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).from('tokens').update({ status: 'found', redeemed_at: new Date().toISOString() }).eq('id', tokenId)
        } catch {}
        // Non-fatal: response was saved; avoid prompting a retry that would create duplicates.
        return { success: true }
      }

      return { success: true }
    } catch (err) {
      let tokenIdLog: unknown = undefined
      try {
        tokenIdLog = input != null && typeof input === 'object' ? (input as { tokenId?: unknown }).tokenId : undefined
      } catch {
        tokenIdLog = '(unable to read)'
      }
      console.error('[submitClaim] ❌ DB exception (inner catch):', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        name: err instanceof Error ? err.name : typeof err,
        tokenId: tokenIdLog,
      })
      return { success: false, error: 'Something went wrong.' }
    }
  } catch (err) {
    let inputSummary: Record<string, unknown> = {}
    try {
      if (input != null && typeof input === 'object') {
        inputSummary = {
          tokenId: (input as { tokenId?: unknown }).tokenId,
          campaignId: (input as { campaignId?: unknown }).campaignId,
          studentEmail: (input as { studentEmail?: unknown }).studentEmail,
        }
      }
    } catch {
      inputSummary = { _logError: 'Could not read input' }
    }
    console.error('[submitClaim] ❌ Unexpected error (outer catch):', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      name: err instanceof Error ? err.name : typeof err,
      input: inputSummary,
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

      const rawCampaignId = (token as { campaign_id?: unknown }).campaign_id
      const campaignId =
        typeof rawCampaignId === 'string' && rawCampaignId.trim().length > 0 && isValidUUID(rawCampaignId.trim())
          ? rawCampaignId.trim()
          : null
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

      const t = token as { id: string; campaign_id?: unknown }
      return { token: { id: t.id, campaign_id: campaignId }, campaign }
    } catch (err) {
      console.error('[getTokenForClaim] DB exception:', err)
      return null
    }
  } catch {
    return null
  }
}

// 3. ADMIN FUNCTIONS (bulkAssignTokensToSchool re-exported from @/app/fleet/fleet-actions)

export { bulkAssignTokensToSchool }

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
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

// Redemption success message (Phase 0: configurable note + link on claim success)
const REDEMPTION_NOTE_MAX_LENGTH = 200
const REDEMPTION_LINK_MAX_LENGTH = 2048

export type RedemptionSuccessMessage = { note: string | null; link: string | null }

/** Used by claim page (server) and Settings tab (client). Service role for claim-page read. */
export async function getRedemptionSuccessMessage(): Promise<RedemptionSuccessMessage> {
  try {
    const supabase = getSupabaseService()
    if (!supabase) return { note: null, link: null }
    const { data, error } = await supabase
      .from('site_settings')
      .select('redemption_success_note, redemption_success_link')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data) return { note: null, link: null }
    const row = data as { redemption_success_note?: string | null; redemption_success_link?: string | null }
    const note =
      typeof row.redemption_success_note === 'string' && row.redemption_success_note.trim().length > 0
        ? row.redemption_success_note.trim().slice(0, REDEMPTION_NOTE_MAX_LENGTH)
        : null
    const link =
      typeof row.redemption_success_link === 'string' && row.redemption_success_link.trim().length > 0
        ? row.redemption_success_link.trim().slice(0, REDEMPTION_LINK_MAX_LENGTH)
        : null
    return { note, link }
  } catch {
    return { note: null, link: null }
  }
}

export async function setRedemptionSuccessMessage(
  note: string,
  link: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const noteVal = typeof note === 'string' ? note.trim().slice(0, REDEMPTION_NOTE_MAX_LENGTH) : ''
    const linkVal = typeof link === 'string' ? link.trim().slice(0, REDEMPTION_LINK_MAX_LENGTH) : ''

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('site_settings')
      .update({
        redemption_success_note: noteVal || null,
        redemption_success_link: linkVal || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)

    if (error) return { success: false, error: error.message ?? 'Update failed.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed.' }
  }
}

const VALID_ROLES: UserRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'AUDITOR', 'STUDENT']
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 6

export async function createUserByEmail(
  email: string,
  password: string,
  role: string,
  organizationId?: string,
  options?: { firstName?: string; lastName?: string; phone?: string }
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
      return { success: false, error: 'Only SUPER_ADMIN can create users.' }
    }

    const trimmedEmail = typeof email === 'string' ? email.trim() : ''
    if (!EMAIL_REGEX.test(trimmedEmail)) return { success: false, error: 'Invalid email format.' }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
    }
    if (!VALID_ROLES.includes(role as UserRole)) {
      return { success: false, error: 'Invalid role. Must be one of: SUPER_ADMIN, ORG_ADMIN, AUDITOR, STUDENT.' }
    }

    const firstName = options?.firstName != null ? String(options.firstName).trim() : null
    const lastName = options?.lastName != null ? String(options.lastName).trim() : null
    const phone = options?.phone != null ? String(options.phone).trim() : null
    if ((role === 'SUPER_ADMIN' || role === 'ORG_ADMIN') && !phone) {
      return { success: false, error: 'Phone number is required for SuperAdmin and OrgAdmin access.' }
    }

    let orgId: string | null = null
    if (organizationId != null && organizationId.trim() !== '') {
      orgId = organizationId.trim()
      if (!isValidUUID(orgId)) return { success: false, error: 'Invalid organization ID.' }
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    if (orgId) {
      const { data: org } = await supabase.from('organizations').select('id').eq('id', orgId).single()
      if (!org) return { success: false, error: 'Organization not found.' }
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
    })

    if (authError) {
      return { success: false, error: authError.message ?? 'Failed to create user.' }
    }
    if (!authData?.user?.id) {
      return { success: false, error: 'User created but no user id returned.' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: profileError } = await (supabase as any)
      .from('profiles')
      .upsert(
        {
          id: authData.user.id,
          email: trimmedEmail,
          role,
          organization_id: orgId ?? null,
          first_name: firstName ?? null,
          last_name: lastName ?? null,
          phone: phone ?? null,
        },
        { onConflict: 'id' }
      )

    if (profileError) {
      return { success: false, error: profileError.message ?? 'User created but profile update failed.' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create user.' }
  }
}

export type ListUserRow = {
  id: string
  email: string
  role: string
  organization_id: string | null
  organization_name: string | null
  last_sign_in_at: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
}

const LIST_USERS_LIMIT = 100

export async function listUsers(): Promise<ListUserRow[]> {
  try {
    const supabaseAuth = await createServerSupabase()
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) return []

    const { data: profile } = await supabaseAuth
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if ((profile as { role?: string } | null)?.role !== 'SUPER_ADMIN') {
      return []
    }

    const supabase = getSupabaseService()
    if (!supabase) return []

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, role, organization_id, first_name, last_name, phone')
      .order('email')
      .limit(LIST_USERS_LIMIT)

    if (profileError) return []
    if (!profileData?.length) return []

    const orgIds = [...new Set((profileData as Array<{ organization_id: string | null }>).map((r) => r.organization_id).filter(Boolean))] as string[]
    const orgNameMap = new Map<string, string>()
    if (orgIds.length > 0) {
      const { data: orgData } = await supabase.from('organizations').select('id, name').in('id', orgIds)
      ;(orgData ?? []).forEach((o: { id: string; name: string }) => orgNameMap.set(o.id, o.name))
    }

    const lastSignInMap = new Map<string, string | null>()
    const profileIds = new Set((profileData as Array<{ id: string }>).map((r) => r.id))
    let authPage = 1
    const authPerPage = 1000
    const maxAuthPages = 15
    while (authPage <= maxAuthPages) {
      const { data: authData } = await supabase.auth.admin.listUsers({ page: authPage, perPage: authPerPage })
      const users = (authData?.users ?? []) as Array<{ id: string; last_sign_in_at?: string | null }>
      if (!users.length) break
      users.forEach((u) => {
        if (profileIds.has(u.id)) lastSignInMap.set(u.id, u.last_sign_in_at ?? null)
      })
      if (lastSignInMap.size >= profileIds.size) break
      if (users.length < authPerPage) break
      authPage += 1
    }

    return (profileData as Array<{ id: string; email: string; role: string; organization_id: string | null; first_name?: string | null; last_name?: string | null; phone?: string | null }>).map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      organization_id: r.organization_id,
      organization_name: r.organization_id ? orgNameMap.get(r.organization_id) ?? null : null,
      last_sign_in_at: lastSignInMap.get(r.id) ?? null,
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      phone: r.phone ?? null,
    }))
  } catch {
    return []
  }
}

export async function updateUserRole(
  profileId: string,
  role: string,
  organizationId?: string | null,
  profileFields?: { first_name?: string | null; last_name?: string | null; phone?: string | null }
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
      return { success: false, error: 'Only SUPER_ADMIN can update user role.' }
    }

    if (!isValidUUID(profileId)) return { success: false, error: 'Invalid user id.' }
    if (!VALID_ROLES.includes(role as UserRole)) {
      return { success: false, error: 'Invalid role. Must be one of: SUPER_ADMIN, ORG_ADMIN, AUDITOR, STUDENT.' }
    }

    if (role === 'SUPER_ADMIN' || role === 'ORG_ADMIN') {
      const phoneVal = profileFields?.phone != null ? String(profileFields.phone).trim() : ''
      if (!phoneVal) return { success: false, error: 'Phone number is required for SuperAdmin and OrgAdmin access.' }
    }

    let orgId: string | null = null
    if (organizationId != null && String(organizationId).trim() !== '') {
      const trimmed = String(organizationId).trim()
      if (!isValidUUID(trimmed)) return { success: false, error: 'Invalid organization id.' }
      orgId = trimmed
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const updatePayload: Record<string, unknown> = { role, organization_id: orgId }
    if (profileFields) {
      if (profileFields.first_name !== undefined) updatePayload.first_name = profileFields.first_name ?? null
      if (profileFields.last_name !== undefined) updatePayload.last_name = profileFields.last_name ?? null
      if (profileFields.phone !== undefined) updatePayload.phone = profileFields.phone ?? null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('profiles')
      .update(updatePayload)
      .eq('id', profileId)

    if (error) return { success: false, error: error.message ?? 'Update failed.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed.' }
  }
}

export async function resetUserPassword(
  userId: string,
  newPassword: string
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
      return { success: false, error: 'Only SUPER_ADMIN can reset passwords.' }
    }

    if (!isValidUUID(userId)) return { success: false, error: 'Invalid user id.' }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const { error } = await supabase.auth.admin.updateUserById(userId, { password: newPassword })

    if (error) return { success: false, error: error.message ?? 'Password reset failed.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Password reset failed.' }
  }
}

const ORG_TYPES = ['school', 'institution'] as const
export type OrganizationType = (typeof ORG_TYPES)[number]

export async function createOrganization(
  name: string,
  slug: string | null,
  type: string
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
      return { success: false, error: 'Only SUPER_ADMIN can create organizations.' }
    }

    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (!trimmedName) return { success: false, error: 'Organization name is required.' }
    if (!ORG_TYPES.includes(type as OrganizationType)) {
      return { success: false, error: 'Type must be school or institution.' }
    }

    let slugValue: string | null = null
    if (slug != null && typeof slug === 'string' && slug.trim() !== '') {
      slugValue = slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      if (slugValue === '') slugValue = null
    }
    if (slugValue == null) {
      slugValue = trimmedName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || null
    }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('organizations')
      .insert({ name: trimmedName, slug: slugValue, type })

    if (error) return { success: false, error: error.message ?? 'Failed to create organization.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create organization.' }
  }
}

export async function deleteOrganization(
  orgId: string
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
      return { success: false, error: 'Only SUPER_ADMIN can delete organizations.' }
    }

    if (!isValidUUID(orgId)) return { success: false, error: 'Invalid organization id.' }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const { count: tokenCount } = await supabase
      .from('tokens')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
    if ((tokenCount ?? 0) > 0) {
      return { success: false, error: `Cannot delete: organization is linked to ${tokenCount} token(s). Reassign or remove tokens first.` }
    }

    const { count: campaignCount } = await supabase
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
    if ((campaignCount ?? 0) > 0) {
      return { success: false, error: `Cannot delete: organization has ${campaignCount} campaign(s). Move or delete campaigns first.` }
    }

    const { count: profileCount } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
    if ((profileCount ?? 0) > 0) {
      return { success: false, error: `Cannot delete: ${profileCount} user(s) are assigned to this organization. Reassign them first.` }
    }

    const { error } = await supabase.from('organizations').delete().eq('id', orgId)
    if (error) return { success: false, error: error.message ?? 'Failed to delete organization.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete organization.' }
  }
}

// --- Access request (landing page) ---

export type SubmitAccessRequestInput = { name: string; email: string; institution?: string; message?: string }

const ACCESS_REQUEST_NAME_MAX = 200
const ACCESS_REQUEST_EMAIL_MAX = 320
const ACCESS_REQUEST_INSTITUTION_MAX = 500
const ACCESS_REQUEST_MESSAGE_MAX = 2000

export async function submitAccessRequest(
  input: SubmitAccessRequestInput
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const name = (input.name ?? '').trim().slice(0, ACCESS_REQUEST_NAME_MAX)
    const email = (input.email ?? '').trim().slice(0, ACCESS_REQUEST_EMAIL_MAX)
    const institution = (input.institution ?? '').trim().slice(0, ACCESS_REQUEST_INSTITUTION_MAX) || null
    const message = (input.message ?? '').trim().slice(0, ACCESS_REQUEST_MESSAGE_MAX) || null
    if (!name) return { success: false, error: 'Name is required.' }
    if (!email) return { success: false, error: 'Email is required.' }

    const supabase = getSupabaseService()
    if (!supabase) return { success: false, error: 'Server configuration error.' }

    const apiKey = (process.env.RESEND_API_KEY ?? '').trim()
    const toEmail = (process.env.ACCESS_REQUEST_EMAIL ?? '').trim()
    if (!apiKey || !toEmail) {
      console.error('[submitAccessRequest] Missing RESEND_API_KEY or ACCESS_REQUEST_EMAIL')
      return { success: false, error: 'Request access is temporarily unavailable. Please try again later or contact support.' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase as any).from('access_requests').insert({
      name,
      email,
      institution,
      message,
    })
    if (insertError) {
      console.error('[submitAccessRequest] Insert error:', insertError.message)
      const isDev = process.env.NODE_ENV === 'development'
      return {
        success: false,
        error: isDev ? insertError.message : 'Could not submit request. Please try again.',
      }
    }

    const fromEmail = (process.env.RESEND_FROM ?? 'onboarding@resend.dev').trim()
    const resend = new Resend(apiKey)
    const { error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `Access request: ${name} (${email})`,
      text: `Name: ${name}\nEmail: ${email}\nInstitution: ${institution ?? '(none)'}\nMessage: ${message ?? '(none)'}`,
    })
    if (emailError) {
      console.error('[submitAccessRequest] Resend error:', emailError.message)
      return { success: false, error: 'Request saved but email failed. Please try again or contact support.' }
    }

    return { success: true }
  } catch (err) {
    console.error('[submitAccessRequest] Unexpected error:', err)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}
