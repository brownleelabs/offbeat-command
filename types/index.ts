/** 6-state token status (Ghost-in-the-Shell model). */
export type TokenStatus =
  | "MINTED"             // Digital value from yield (Ghost)
  | "DORMANT"           // Physical chip deployed but empty (Shell)
  | "ACTIVE"            // Asset ID assigned to physical ID (Live)
  | "PENDING_SETTLEMENT" // Student tapped, Venmo processing (Locked)
  | "REDEEMED"          // Payout complete, asset consumed (Spent)
  | "VOID";             // Stolen/Lost hardware (Kill Switch)

/** Strict token type: id, lat, lng, status (6-state). */
export interface Token {
  id: string;
  lat: number;
  lng: number;
  status: TokenStatus;
  organization_id: string | null;
  /** Immutable hardware ID from NTAG 424 DNA. */
  nfc_uid?: string | null;
  /** Transient financial ID ($25 value); required when status = ACTIVE. */
  asset_uuid?: string | null;
  /** Optional reference to BENJI transaction that minted this. */
  yield_source_id?: string | null;
  /** Token balance in USD; used by Fleet and claim flows. */
  balance?: number;
  created_at?: string | null;
  redeemed_at?: string | null;
  reloaded_at?: string | null;
}

/** Row as returned from Supabase (may use latitude/longitude column names; status may be string from DB). */
export type TokenRow = {
  id: string;
  status: TokenStatus | string;
  organization_id?: string | null;
  nfc_uid?: string | null;
  asset_uuid?: string | null;
  yield_source_id?: string | null;
  balance?: number | null;
  created_at?: string | null;
  redeemed_at?: string | null;
  reloaded_at?: string | null;
} & (
  | { lat: number; lng: number }
  | { latitude: number; longitude: number }
);

/** Normalize status from DB (legacy 'active'|'found' or 6-state). */
export function normalizeTokenStatus(s: unknown): TokenStatus {
  if (s === "found" || s === "REDEEMED") return "REDEEMED";
  if (s === "active") return "ACTIVE";
  if (s === "DORMANT" || s === "ACTIVE" || s === "MINTED" || s === "PENDING_SETTLEMENT" || s === "VOID")
    return s as TokenStatus;
  return "DORMANT";
}

export function rowToToken(row: TokenRow): Token {
  const lat = "lat" in row ? row.lat : row.latitude;
  const lng = "lng" in row ? row.lng : row.longitude;
  return {
    id: row.id,
    lat,
    lng,
    status: normalizeTokenStatus(row.status),
    organization_id: row.organization_id ?? null,
    nfc_uid: row.nfc_uid ?? null,
    asset_uuid: row.asset_uuid ?? null,
    yield_source_id: row.yield_source_id ?? null,
    balance: row.balance != null ? Number(row.balance) : undefined,
    created_at: row.created_at ?? null,
    redeemed_at: row.redeemed_at ?? null,
    reloaded_at: row.reloaded_at ?? null,
  };
}

/** Required field key for reward payout (stored in campaign.required_fields). */
export type CampaignRequiredFieldKey =
  | "first_name"
  | "last_name"
  | "student_id"
  | "student_email"
  | "venmo_username";

export interface CampaignRequiredField {
  key: CampaignRequiredFieldKey;
  label: string;
}

/** Default required fields for every campaign (reward payout). */
export const CAMPAIGN_REQUIRED_FIELDS: CampaignRequiredField[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "student_id", label: "Student ID" },
  { key: "student_email", label: "Student email" },
  { key: "venmo_username", label: "Venmo username" },
];

/** Campaign status: draft (not launched), active (accepting claims), inactive (archived or deleted). */
export type CampaignStatus = "draft" | "active" | "inactive";

/** Campaign (survey) stored in Supabase. */
export interface Campaign {
  id: string;
  name: string;
  created_at?: string;
  organization_id: string | null;
  /** draft | active | inactive; default draft. */
  status?: CampaignStatus | null;
  /** Set when status moves to active. */
  launched_at?: string | null;
  /** Soft delete; when set, campaign is archived and claims are blocked. */
  deleted_at?: string | null;
  deleted_by?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  owner_user_id?: string | null;
  last_viewed_at?: string | null;
  pinned?: boolean | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
  /** Required fields for reward payout; stored as JSONB. */
  required_fields?: CampaignRequiredField[];
  /** Up to 10 custom questions; stored as JSONB in DB. */
  questions?: CampaignQuestion[];
}

export interface CampaignQuestion {
  order: number;
  text: string;
}

/** Token row joined with campaign and optional org (for Fleet table). Use select('*, campaigns(name), organizations(name)'). */
export interface TokenWithCampaign extends Token {
  campaign_id?: string | null;
  campaigns: { name: string } | null;
  /** Present when query includes organizations join; used for org column when SUPER_ADMIN or AUDITOR. */
  organizations?: { name: string } | null;
  /** Token balance in USD; 0 until funds are loaded. */
  balance?: number;
  /** When the token/asset was created (Fleet table Created column). */
  created_at?: string | null;
}

/** Map view token row: id, lat, lng, status (6-state), organization_id, campaign_id, redeemed_at, nfc_uid, asset_uuid. */
export interface MapTokenRow {
  id: string;
  lat: number;
  lng: number;
  status: TokenStatus;
  organization_id: string | null;
  campaign_id: string | null;
  redeemed_at: string | null;
  nfc_uid: string | null;
  asset_uuid: string | null;
}

/** Token object returned by Fleet getToken (success shape). Used by GetTokenResult. */
export interface FleetTokenDetail {
  id: string;
  lat: number;
  lng: number;
  status: TokenStatus;
  organization_id: string | null;
  campaign_id: string | null;
  balance?: number;
  created_at?: string | null;
  redeemed_at?: string | null;
  reloaded_at?: string | null;
  nfc_uid?: string | null;
  asset_uuid?: string | null;
  yield_source_id?: string | null;
  campaigns?: { name: string } | null;
  organizations?: { name: string } | null;
  claim_url?: string;
  claim_url_restricted?: boolean;
  redeemer?: { first_name: string; last_name: string; student_email: string; student_id: string } | null;
  first_redeemer?: { first_name: string; last_name: string; student_email: string; student_id: string } | null;
}

export type UserRole = "SUPER_ADMIN" | "ORG_ADMIN" | "AUDITOR" | "STUDENT";

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  organization_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

/** Deal scenario stored in deal_scenarios table. */
export interface DealScenario {
  id: string;
  name: string;
  target_students: number;
  redemption_velocity: number;
  assumed_yield_rate: number; // Stored as percentage (e.g., 3.0 for 3.0%)
  tdv_amount: number;
  annual_student_welfare: number;
  annual_operator_revenue: number;
  annual_principal_protection: number;
  created_at?: string;
}
