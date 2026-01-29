'use server'

import { createServerSupabase } from '@/lib/supabase-server'
import { CAMPAIGN_REQUIRED_FIELDS } from '@/types'
import type { CampaignRequiredField, CampaignQuestion } from '@/types'

// Store as Set<string> because JSON payloads provide string keys (runtime validation still enforced).
const ALLOWED_REQUIRED_FIELD_KEYS = new Set<string>(CAMPAIGN_REQUIRED_FIELDS.map((f) => f.key))

const SUPER_ADMIN_ONLY = 'Only SUPER_ADMIN can perform this action.'

/** Design scale: list pagination and indexes support up to 10,000 campaigns. */
const MAX_CAMPAIGNS_DESIGN = 10_000

const CAMPAIGN_NAME_MAX_LENGTH = 500

/** Event types for campaign_audit_log (fully auditable data collection). */
export type CampaignAuditEventType =
  | 'created' | 'launched' | 'updated' | 'archived' | 'unarchived' | 'deleted' | 'restored'
  | 'viewed' | 'pinned' | 'unpinned' | 'exported'

/** Append-only audit log; non-blocking (log and continue if insert fails). */
async function logCampaignAudit(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  campaignId: string,
  eventType: CampaignAuditEventType,
  actorUserId: string | null,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase.from('campaign_audit_log').insert({
      campaign_id: campaignId,
      event_type: eventType,
      actor_user_id: actorUserId,
      payload: payload ?? null,
    })
    if (error) {
      console.error('[campaign-actions] audit log insert failed:', { campaignId, eventType, err: error })
    }
  } catch (err) {
    console.error('[campaign-actions] audit log insert failed:', { campaignId, eventType, err })
  }
}

async function requireSuperAdmin(): Promise<
  { ok: true; userId: string | null } | { ok: false; error: string }
> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = (profile as { role?: string } | null)?.role
  if (role !== 'SUPER_ADMIN') return { ok: false, error: SUPER_ADMIN_ONLY }
  return { ok: true, userId: user.id }
}

export type ListCampaignsInput = {
  page: number
  pageSize: number
  searchQuery?: string
  showArchived?: boolean
  showDeleted?: boolean
  status?: 'draft' | 'active' | 'inactive'
}

export type ListCampaignsResult<T> =
  | { success: true; rows: T[]; total: number }
  | { success: false; error: string }

function clampInt(n: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }) {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  const i = Math.trunc(v)
  return Math.min(max, Math.max(min, i))
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function listCampaigns<T = unknown>(
  input: ListCampaignsInput
): Promise<ListCampaignsResult<T>> {
  try {
    if (!input || typeof input !== 'object') return { success: false, error: 'Failed to load campaigns.' }
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const pageSize = clampInt(input.pageSize, { min: 10, max: 200, fallback: 50 })
    const maxPageByDesign = Math.max(1, Math.ceil(MAX_CAMPAIGNS_DESIGN / pageSize))
    const page = Math.min(clampInt(input.page, { min: 1, max: 10_000, fallback: 1 }), maxPageByDesign)
    const q = String(input.searchQuery ?? '').trim().slice(0, 500)
    const searchByUuid = !!q && isUuidLike(q)
    const from = searchByUuid ? 0 : (page - 1) * pageSize
    const to = searchByUuid ? 0 : from + pageSize - 1

    const showArchived = !!input.showArchived
    const showDeleted = !!input.showDeleted
    const statusFilter =
      input.status === 'draft' || input.status === 'active' || input.status === 'inactive'
        ? input.status
        : undefined

    const supabase = await createServerSupabase()

    let query = supabase
      .from('campaigns')
      .select('*', { count: 'exact' })

    if (!showArchived) query = query.is('archived_at', null)
    if (!showDeleted) query = query.is('deleted_at', null)
    if (statusFilter) query = query.eq('status', statusFilter)

    if (q) {
      if (searchByUuid) {
        query = query.eq('id', q)
      } else {
        const safe = q.replace(/[(),]/g, ' ').trim()
        if (safe) {
          // Escape for PostgreSQL ILIKE: \ % _ (backslash first so we don't double-escape)
          const escaped = safe.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
          query = query.ilike('name', `%${escaped}%`)
        }
      }
    }

    const { data, error, count } = await query
      .order('pinned', { ascending: false })
      .order('pinned_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (error) return { success: false, error: 'Failed to load campaigns.' }

    const rows = Array.isArray(data) ? data : []
    const rawTotal = count ?? 0
    const total =
      typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0
        ? Math.min(Math.floor(rawTotal), MAX_CAMPAIGNS_DESIGN)
        : 0
    return { success: true, rows: rows as T[], total }
  } catch (err) {
    return { success: false, error: 'Failed to load campaigns.' }
  }
}

export async function getCampaign(id: string): Promise<
  { success: true; campaign: unknown } | { success: false; error: string }
> {
  try {
    if (typeof id !== 'string' || !isUuidLike(id)) return { success: false, error: 'Invalid campaign id.' }
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) return { success: false, error: 'Campaign not found.' }
    return { success: true, campaign: data }
  } catch (err) {
    return { success: false, error: 'Failed to load campaign.' }
  }
}

const ALLOWED_CAMPAIGN_KEYS = new Set([
  'name', 'organization_id', 'required_fields', 'questions', 'status',
])

function pickAllowedCampaign(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (ALLOWED_CAMPAIGN_KEYS.has(key)) out[key] = obj[key]
  }
  return out
}

function normalizeRequiredFields(v: unknown): CampaignRequiredField[] {
  if (Array.isArray(v) && v.length > 0) {
    const seen = new Set<string>()
    const filtered = v.filter(
      (item): item is CampaignRequiredField => {
        if (
          item == null ||
          typeof item !== 'object' ||
          !('key' in item) ||
          typeof (item as { key: string }).key !== 'string' ||
          !ALLOWED_REQUIRED_FIELD_KEYS.has((item as { key: string }).key) ||
          !('label' in item) ||
          typeof (item as { label: string }).label !== 'string' ||
          (item as { label: string }).label.trim().length === 0
        ) {
          return false
        }
        const key = (item as { key: string }).key
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }
    ) as CampaignRequiredField[]
    return filtered.length > 0 ? filtered : CAMPAIGN_REQUIRED_FIELDS
  }
  return CAMPAIGN_REQUIRED_FIELDS
}

function normalizeQuestions(v: unknown): CampaignQuestion[] | null {
  if (!Array.isArray(v)) return null
  const out: CampaignQuestion[] = []
  for (let i = 0; i < v.length && i < 10; i++) {
    const item = v[i]
    if (item != null && typeof item === 'object' && 'text' in item && typeof (item as { text: string }).text === 'string') {
      const text = (item as { text: string }).text.trim()
      if (text.length > 0) {
        const rawOrder = (item as { order?: number }).order
        const order =
          typeof rawOrder === 'number' && Number.isFinite(rawOrder)
            ? Math.max(1, Math.min(10, Math.trunc(rawOrder)))
            : i + 1
        out.push({ order, text })
      }
    }
  }
  return out.length ? out : null
}

export async function insertCampaign(
  payload: Record<string, unknown>
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    if (!payload || typeof payload !== 'object') return { success: false, error: 'Insert failed.' }
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const supabase = await createServerSupabase()
    const now = new Date().toISOString()
    const userId = auth.userId ?? null

    const raw = pickAllowedCampaign(payload)
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, CAMPAIGN_NAME_MAX_LENGTH) : ''
    if (!name) return { success: false, error: 'Campaign name is required.' }

    const organizationId = typeof raw.organization_id === 'string' ? raw.organization_id.trim() : null
    if (!organizationId || !isUuidLike(organizationId)) {
      return { success: false, error: 'Valid organization is required.' }
    }

    const { data: orgRow } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', organizationId)
      .maybeSingle()
    if (!orgRow) {
      return { success: false, error: 'Organization not found.' }
    }

    const requiredFields = normalizeRequiredFields(raw.required_fields)
    const questions = normalizeQuestions(raw.questions)

    const insertPayload: Record<string, unknown> = {
      name,
      organization_id: organizationId,
      required_fields: requiredFields,
      questions,
      status: 'draft',
      owner_user_id: userId,
      last_viewed_at: now,
      pinned: false,
    }

    const { data, error } = await supabase
      .from('campaigns')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) return { success: false, error: 'Insert failed.' }
    const id = (data as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || id.length === 0 || !isUuidLike(id)) return { success: false, error: 'Insert failed.' }
    await logCampaignAudit(supabase, id, 'created', userId, { name, organization_id: organizationId })
    return { success: true, id }
  } catch (err) {
    return { success: false, error: 'Insert failed.' }
  }
}

const ALLOWED_UPDATE_KEYS = new Set(['name', 'required_fields', 'questions', 'status'])

function pickAllowedUpdate(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (ALLOWED_UPDATE_KEYS.has(key)) out[key] = obj[key]
  }
  return out
}

export async function updateCampaign(
  id: string,
  payload: Record<string, unknown>
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (typeof id !== 'string' || !isUuidLike(id)) return { success: false, error: 'Invalid campaign id.' }
    if (!payload || typeof payload !== 'object') return { success: false, error: 'Update failed.' }
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const raw = pickAllowedUpdate(payload)
    const updates: Record<string, unknown> = {}

    if (raw.name !== undefined) {
      const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, CAMPAIGN_NAME_MAX_LENGTH) : ''
      if (!name) return { success: false, error: 'Campaign name cannot be empty.' }
      updates.name = name
    }
    if (raw.required_fields !== undefined) {
      updates.required_fields = normalizeRequiredFields(raw.required_fields)
    }
    if (raw.questions !== undefined) {
      updates.questions = normalizeQuestions(raw.questions)
    }
    if (raw.status !== undefined) {
      const status = raw.status === 'draft' || raw.status === 'active' || raw.status === 'inactive' ? raw.status : undefined
      if (status !== undefined) {
        updates.status = status
        if (status === 'active') {
          updates.launched_at = new Date().toISOString()
        }
      }
    }

    if (Object.keys(updates).length === 0) return { success: true }

    const supabase = await createServerSupabase()
    const { data: existing, error: fetchError } = await supabase
      .from('campaigns')
      .select('status, archived_at, deleted_at')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return { success: false, error: 'Campaign not found.' }
    }

    const existingRow = existing as { status?: string | null; archived_at?: string | null; deleted_at?: string | null }
    // Extra invariant guard: archived/deleted campaigns should not be launchable/updatable
    if (existingRow.archived_at || existingRow.deleted_at) {
      return { success: false, error: 'Archived or deleted campaigns cannot be updated.' }
    }

    const currentStatus = existingRow.status ?? 'draft'
    const isDraft = currentStatus === 'draft'

    if (!isDraft) {
      if ('name' in updates || 'required_fields' in updates || 'questions' in updates) {
        return { success: false, error: 'Only draft campaigns can be edited.' }
      }
      if (updates.status && updates.status !== currentStatus) {
        return { success: false, error: 'Only draft campaigns can change status.' }
      }
    }

    // Only set launched_at on transition to active; do not overwrite if already active (data integrity)
    const alreadyActive = currentStatus === 'active'
    if (updates.launched_at != null && alreadyActive) {
      delete updates.launched_at
    }
    const didLaunch = updates.status === 'active' && !alreadyActive

    const { error } = await supabase.from('campaigns').update(updates).eq('id', id)

    if (error) return { success: false, error: 'Update failed.' }
    const eventType: CampaignAuditEventType = didLaunch ? 'launched' : 'updated'
    await logCampaignAudit(supabase, id, eventType, auth.userId ?? null, updates as Record<string, unknown>)
    return { success: true }
  } catch (err) {
    return { success: false, error: 'Update failed.' }
  }
}

const BATCH_IDS_MAX = 200

export async function archiveCampaigns(
  ids: string[],
  archived: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const idsList = Array.isArray(ids) ? ids : []
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }
    const validIds = [...new Set(
      idsList.filter((id) => typeof id === 'string' && id.length > 0 && isUuidLike(id))
    )].slice(0, BATCH_IDS_MAX)
    if (idsList.length > BATCH_IDS_MAX) return { success: false, error: `Too many campaigns (max ${BATCH_IDS_MAX} per batch).` }
    if (validIds.length === 0) {
      return idsList.length > 0
        ? { success: false, error: 'No valid campaign IDs.' }
        : { success: true }
    }

    const supabase = await createServerSupabase()
    const now = new Date().toISOString()
    const userId = auth.userId ?? null

    const payload = archived
      ? { archived_at: now, archived_by: userId, deleted_at: null, deleted_by: null, status: 'inactive' as const }
      : { archived_at: null, archived_by: null }

    const { error } = await supabase.from('campaigns').update(payload).in('id', validIds)
    if (error) return { success: false, error: 'Update failed.' }
    const eventType: CampaignAuditEventType = archived ? 'archived' : 'unarchived'
    for (const cid of validIds) {
      await logCampaignAudit(supabase, cid, eventType, userId, { archived })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: 'Update failed.' }
  }
}

export async function softDeleteCampaigns(
  ids: string[],
  deleted: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const idsList = Array.isArray(ids) ? ids : []
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }
    const validIds = [...new Set(
      idsList.filter((id) => typeof id === 'string' && id.length > 0 && isUuidLike(id))
    )].slice(0, BATCH_IDS_MAX)
    if (idsList.length > BATCH_IDS_MAX) return { success: false, error: `Too many campaigns (max ${BATCH_IDS_MAX} per batch).` }
    if (validIds.length === 0) {
      return idsList.length > 0
        ? { success: false, error: 'No valid campaign IDs.' }
        : { success: true }
    }

    const supabase = await createServerSupabase()
    const now = new Date().toISOString()
    const userId = auth.userId ?? null

    const payload = deleted
      ? { deleted_at: now, deleted_by: userId, archived_at: null, archived_by: null, status: 'inactive' as const }
      : { deleted_at: null, deleted_by: null }

    const { error } = await supabase.from('campaigns').update(payload).in('id', validIds)
    if (error) return { success: false, error: 'Update failed.' }
    const eventType: CampaignAuditEventType = deleted ? 'deleted' : 'restored'
    for (const cid of validIds) {
      await logCampaignAudit(supabase, cid, eventType, userId, { deleted })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: 'Update failed.' }
  }
}

export async function updateCampaignPinned(
  id: string,
  pinned: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (typeof id !== 'string' || !isUuidLike(id)) return { success: false, error: 'Invalid campaign id.' }
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const supabase = await createServerSupabase()
    const now = new Date().toISOString()
    const userId = auth.userId ?? null

    const { error } = await supabase
      .from('campaigns')
      .update(
        pinned
          ? { pinned: true, pinned_at: now, pinned_by: userId }
          : { pinned: false, pinned_at: null, pinned_by: null }
      )
      .eq('id', id)

    if (error) return { success: false, error: 'Update failed.' }
    await logCampaignAudit(supabase, id, pinned ? 'pinned' : 'unpinned', userId, { pinned })
    return { success: true }
  } catch (err) {
    return { success: false, error: 'Update failed.' }
  }
}

export async function markCampaignViewed(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (typeof id !== 'string' || !isUuidLike(id)) return { success: false, error: 'Invalid campaign id.' }
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const supabase = await createServerSupabase()
    const { error } = await supabase
      .from('campaigns')
      .update({ last_viewed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { success: false, error: 'Update failed.' }
    await logCampaignAudit(supabase, id, 'viewed', auth.userId ?? null)
    return { success: true }
  } catch (err) {
    return { success: false, error: 'Update failed.' }
  }
}
