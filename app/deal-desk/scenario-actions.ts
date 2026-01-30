'use server'

import { createServerSupabase } from '@/lib/supabase-server'
import { requireSuperAdmin } from '@/lib/auth-server'
import { isUuidLike, clampInt } from '@/lib/validation'

export type ListDealScenariosInput = {
  page: number
  pageSize: number
  searchQuery?: string
  showArchived?: boolean
  showDeleted?: boolean
}

export type ListDealScenariosResult<T> =
  | { success: true; rows: T[]; total: number }
  | { success: false; error: string }

export async function listDealScenarios<T = unknown>(
  input: ListDealScenariosInput
): Promise<ListDealScenariosResult<T>> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const page = clampInt(input.page, { min: 1, max: 10_000, fallback: 1 })
    const pageSize = clampInt(input.pageSize, { min: 10, max: 200, fallback: 50 })
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const q = (input.searchQuery ?? '').trim()
    const showArchived = !!input.showArchived
    const showDeleted = !!input.showDeleted

    const supabase = await createServerSupabase()

    let query = supabase
      .from('deal_scenarios')
      .select('*', { count: 'exact' })

    if (!showArchived) query = query.is('archived_at', null)
    if (!showDeleted) query = query.is('deleted_at', null)

    // Server-side search (fast for 1k+; backed by trigram indexes in migrations)
    if (q) {
      if (isUuidLike(q)) {
        query = query.eq('id', q)
      } else {
        // Defensive: Supabase `.or()` uses a filter expression string, so we must
        // ensure the user query cannot break the expression by injecting commas
        // or parentheses. Strip those characters before building the filter.
        const safe = q.replace(/[(),]/g, ' ').trim()
        if (safe) {
          const escaped = safe.replace(/[%_]/g, '\\$&')
          query = query.or(`name.ilike.%${escaped}%,university_name.ilike.%${escaped}%`)
        }
      }
    }

    // Stable sort + pinned-first UX
    const { data, error, count } = await query
      .order('pinned', { ascending: false })
      .order('pinned_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (error) return { success: false, error: error.message ?? 'Failed to load scenarios.' }

    return { success: true, rows: ((data ?? []) as T[]), total: count ?? 0 }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to load scenarios.' }
  }
}

export async function updateDealScenarioPinned(
  id: string,
  pinned: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (!isUuidLike(id)) {
      return { success: false, error: 'Invalid scenario id.' }
    }
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const supabase = await createServerSupabase()
    const now = new Date().toISOString()
    const userId = auth.userId ?? null

    const { error } = await supabase
      .from('deal_scenarios')
      .update(
        pinned
          ? { pinned: true, pinned_at: now, pinned_by: userId }
          : { pinned: false, pinned_at: null, pinned_by: null }
      )
      .eq('id', id)

    if (error) return { success: false, error: error.message ?? 'Update failed.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed.' }
  }
}

const BATCH_IDS_MAX = 200

export async function archiveDealScenarios(
  ids: string[],
  archived: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }
    const validIds = ids
      .filter((id) => typeof id === 'string' && id.length > 0 && isUuidLike(id))
      .slice(0, BATCH_IDS_MAX)
    if (ids.length > BATCH_IDS_MAX) return { success: false, error: `Too many scenarios (max ${BATCH_IDS_MAX} per batch).` }
    if (validIds.length === 0) return { success: true }

    const supabase = await createServerSupabase()
    const now = new Date().toISOString()
    const userId = auth.userId ?? null

    const payload = archived
      ? { archived_at: now, archived_by: userId, deleted_at: null, deleted_by: null }
      : { archived_at: null, archived_by: null }

    const { error } = await supabase.from('deal_scenarios').update(payload).in('id', validIds)
    if (error) return { success: false, error: error.message ?? 'Update failed.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed.' }
  }
}

export async function softDeleteDealScenarios(
  ids: string[],
  deleted: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }
    const validIds = ids
      .filter((id) => typeof id === 'string' && id.length > 0 && isUuidLike(id))
      .slice(0, BATCH_IDS_MAX)
    if (ids.length > BATCH_IDS_MAX) return { success: false, error: `Too many scenarios (max ${BATCH_IDS_MAX} per batch).` }
    if (validIds.length === 0) return { success: true }

    const supabase = await createServerSupabase()
    const now = new Date().toISOString()
    const userId = auth.userId ?? null

    const payload = deleted
      ? { deleted_at: now, deleted_by: userId, archived_at: null, archived_by: null }
      : { deleted_at: null, deleted_by: null }

    const { error } = await supabase.from('deal_scenarios').update(payload).in('id', validIds)
    if (error) return { success: false, error: error.message ?? 'Update failed.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed.' }
  }
}

export async function markDealScenarioViewed(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (!isUuidLike(id)) {
      return { success: false, error: 'Invalid scenario id.' }
    }
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const supabase = await createServerSupabase()
    const { error } = await supabase
      .from('deal_scenarios')
      .update({ last_viewed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { success: false, error: error.message ?? 'Update failed.' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed.' }
  }
}

const ALLOWED_SCENARIO_KEYS = new Set([
  'name', 'university_name', 'endowment_size', 'student_enrollment', 'target_reach_percent',
  'redemption_velocity', 'assumed_yield_rate', 'interest_rate', 'target_students',
  'tdv_amount', 'calculated_tdv', 'upfront_fee', 'projected_arr', 'scenario_group_id',
  'deal_score', 'deal_score_label', 'raw_economic_score', 'score_breakdown',
  'eps_at_save', 'allocation_at_save', 'fee_recoup_years_at_save', 'k_eff_at_save',
  'yield_environment', 'waterfall_shares', 'tags', 'notes', 'pinned',
  'annual_student_welfare', 'annual_operator_revenue', 'annual_principal_protection',
  'allocation_percent', 'deal_zone', 'score_explanation', 'deal_summary', 'version',
])

function pickAllowed(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (ALLOWED_SCENARIO_KEYS.has(key)) out[key] = obj[key]
  }
  return out
}

function safeNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function insertDealScenario(
  payload: Record<string, unknown>
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    const supabase = await createServerSupabase()
    const now = new Date().toISOString()
    const userId = auth.userId ?? null

    const raw = pickAllowed(payload)
    const universityName = typeof raw.university_name === 'string' ? raw.university_name.trim() : ''
    if (!universityName) return { success: false, error: 'Institution name is required.' }
    const endowment = safeNum(raw.endowment_size)
    if (endowment == null || endowment <= 0) return { success: false, error: 'Endowment must be greater than 0.' }
    const enrollment = safeNum(raw.student_enrollment)
    if (enrollment == null || enrollment <= 0) return { success: false, error: 'Enrollment must be greater than 0.' }
    const targetStudents = safeNum(raw.target_students)
    if (targetStudents == null || targetStudents <= 0) return { success: false, error: 'Target students must be greater than 0.' }
    const tdv = safeNum(raw.calculated_tdv) ?? safeNum(raw.tdv_amount)
    if (tdv == null || tdv <= 0) return { success: false, error: 'TDV must be greater than 0.' }

    const nextPayload: Record<string, unknown> = {
      ...raw,
      university_name: universityName,
      endowment_size: endowment,
      student_enrollment: enrollment,
      target_students: targetStudents,
      calculated_tdv: tdv,
      tdv_amount: tdv,
      owner_user_id: userId,
      last_viewed_at: now,
    }

    const groupId = typeof nextPayload.scenario_group_id === 'string' ? nextPayload.scenario_group_id : null
    if (groupId != null && groupId !== '' && !isUuidLike(groupId)) {
      return { success: false, error: 'Invalid scenario group id.' }
    }
    const versionRaw = nextPayload.version
    const hasValidVersion = typeof versionRaw === 'number' && Number.isFinite(versionRaw) && versionRaw > 0
    if (groupId && !hasValidVersion) {
      const { data: latest, error: versionError } = await supabase
        .from('deal_scenarios')
        .select('version')
        .eq('scenario_group_id', groupId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!versionError) {
        const v = (latest as { version?: unknown } | null)?.version
        const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v)
        nextPayload.version = (Number.isFinite(n) ? Math.trunc(n) : 0) + 1
      } else {
        nextPayload.version = 1
      }
    }

    const runInsert = async (): Promise<{ data: unknown; error: { message?: string; code?: string } | null }> => {
      const result = await supabase
        .from('deal_scenarios')
        .insert(nextPayload)
        .select('id')
        .single()
      return result
    }

    let result = await runInsert()
    if (result.error?.code === '23505' && groupId) {
      const { data: latest } = await supabase
        .from('deal_scenarios')
        .select('version')
        .eq('scenario_group_id', groupId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      const v = (latest as { version?: unknown } | null)?.version
      const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v)
      nextPayload.version = (Number.isFinite(n) ? Math.trunc(n) : 0) + 1
      result = await runInsert()
    }

    if (result.error) return { success: false, error: result.error.message ?? 'Insert failed.' }
    const id = (result.data as { id?: string } | null)?.id
    if (!id) return { success: false, error: 'Insert failed (missing id).' }
    return { success: true, id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Insert failed.' }
  }
}

