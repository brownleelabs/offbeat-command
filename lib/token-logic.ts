/**
 * Token state-machine helpers (Ghost-in-the-Shell 6-state model).
 * Used by claim flow and fleet-actions to enforce valid transitions and ACTIVE tether invariant.
 */

import type { TokenStatus } from '@/types'

/** Allowed transitions (from → to). VOID is terminal. MINTED is entry from yield; no transition *to* MINTED in app flow. */
const ALLOWED_TRANSITIONS: Record<TokenStatus, TokenStatus[]> = {
  MINTED: ['DORMANT', 'ACTIVE'],
  DORMANT: ['ACTIVE', 'VOID'],
  ACTIVE: ['PENDING_SETTLEMENT', 'VOID'],
  PENDING_SETTLEMENT: ['REDEEMED', 'DORMANT', 'ACTIVE'], // DORMANT for resetDemo; ACTIVE for zombie cleanup (stuck > 1h)
  REDEEMED: ['DORMANT', 'ACTIVE'],
  VOID: [],
}

/**
 * Returns true only for allowed state transitions.
 * - DORMANT → ACTIVE (Rain Barrel / reload)
 * - ACTIVE → PENDING_SETTLEMENT (tap)
 * - PENDING_SETTLEMENT → REDEEMED (payout), DORMANT (resetDemo), or ACTIVE (zombie cleanup)
 * - REDEEMED → DORMANT or ACTIVE (reload)
 * - MINTED → DORMANT or ACTIVE
 * - ACTIVE/DORMANT → VOID (kill switch)
 * - VOID: no outgoing transitions
 */
export function canTransition(from: TokenStatus, to: TokenStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

/**
 * Enforces "ACTIVE requires tether": when status is ACTIVE, both nfc_uid and asset_uuid must be set.
 * Used before allowing claim or reload. Returns true if the token satisfies the invariant.
 */
export function requireActiveTether(token: {
  status: TokenStatus
  nfc_uid?: string | null
  asset_uuid?: string | null
}): boolean {
  if (token.status !== 'ACTIVE') return true
  const hasNfc = token.nfc_uid != null && String(token.nfc_uid).trim() !== ''
  const hasAsset = token.asset_uuid != null && String(token.asset_uuid).trim() !== ''
  return hasNfc && hasAsset
}
