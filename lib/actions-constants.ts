/** Shared types for server actions. Keep in a non–'use server' file so they can be imported from client. */

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
  /** NFC SUN (Secure Unique NFC) signature from URL when REQUIRE_SUN_SIGNATURE is set. */
  signature?: string | null
}

export type SubmitClaimResult = { success: true } | { success: false; error: string }

export type BulkAssignToSchoolResult =
  | { success: true; count: number }
  | { success: false; error: string }
