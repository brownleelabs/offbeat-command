/** Role permission constants. Shared between server actions and client components. */
import type { UserRole } from '@/types'

/**
 * Domain Management — per docs/FLEET_AUDIT_AND_DOMAIN_PLAN.md.
 * Set NEXT_PUBLIC_CLAIM_BASE_URL in .env.local / Vercel to your live domain (e.g. https://campusmobilityproject.com).
 */
export const CLAIM_BASE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CLAIM_BASE_URL?.trim()) ||
  'https://campusmobilityproject.com'

/** Full claim URL for a token. Use for copy, export CSV, and display. */
export function getClaimUrl(tokenId: string): string {
  const base = CLAIM_BASE_URL.endsWith('/') ? CLAIM_BASE_URL.slice(0, -1) : CLAIM_BASE_URL
  return `${base}/claim/${tokenId}`
}

/** Permission keys controllable by SUPER_ADMIN. */
export const ROLE_PERMISSION_KEYS = ['fleet_write', 'campaigns_write', 'map_reset'] as const
export type RolePermissionKey = (typeof ROLE_PERMISSION_KEYS)[number]

/** Roles that can have permissions toggled (SUPER_ADMIN is always full access in code). */
export const CONTROLLABLE_ROLES = ['ORG_ADMIN', 'AUDITOR'] as const

/** All roles that can be assigned when creating a user (create-user form dropdown). */
export const ALL_ROLES: UserRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'AUDITOR', 'STUDENT']

export type RolePermissionRow = { role: string; permission_key: string; enabled: boolean }
