/** Role permission constants. Shared between server actions and client components. */
import type { UserRole } from '@/types'

/** Permission keys controllable by SUPER_ADMIN. */
export const ROLE_PERMISSION_KEYS = ['fleet_write', 'campaigns_write', 'map_reset'] as const
export type RolePermissionKey = (typeof ROLE_PERMISSION_KEYS)[number]

/** Roles that can have permissions toggled (SUPER_ADMIN is always full access in code). */
export const CONTROLLABLE_ROLES = ['ORG_ADMIN', 'AUDITOR'] as const

/** All roles that can be assigned when creating a user (create-user form dropdown). */
export const ALL_ROLES: UserRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'AUDITOR', 'STUDENT']

export type RolePermissionRow = { role: string; permission_key: string; enabled: boolean }
