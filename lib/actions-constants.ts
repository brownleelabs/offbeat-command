/** Shared types and constants for server actions. Keep in a non–'use server' file so they can be imported from client. */

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

export type BulkAssignToSchoolResult =
  | { success: true; count: number }
  | { success: false; error: string }

/** Permission keys controllable by SUPER_ADMIN. */
export const ROLE_PERMISSION_KEYS = ['fleet_write', 'campaigns_write', 'map_reset'] as const
export type RolePermissionKey = (typeof ROLE_PERMISSION_KEYS)[number]

/** Roles that can have permissions toggled (SUPER_ADMIN is always full access in code). */
export const CONTROLLABLE_ROLES = ['ORG_ADMIN', 'AUDITOR'] as const

export type RolePermissionRow = { role: string; permission_key: string; enabled: boolean }
