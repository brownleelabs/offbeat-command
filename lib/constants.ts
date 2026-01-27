export const ROLE_PERMISSION_KEYS = ['fleet_write', 'campaigns_write', 'map_reset'] as const
export type RolePermissionKey = (typeof ROLE_PERMISSION_KEYS)[number]

export const CONTROLLABLE_ROLES = ['ORG_ADMIN', 'AUDITOR'] as const

export type RolePermissionRow = { role: string; permission_key: string; enabled: boolean }