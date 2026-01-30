/** Strict token type: id, lat, lng, status. */
export interface Token {
  id: string;
  lat: number;
  lng: number;
  status: "active" | "found";
  organization_id: string | null;
}

/** Row as returned from Supabase (may use latitude/longitude column names). */
export type TokenRow = {
  id: string;
  status: "active" | "found";
  organization_id?: string | null;
} & (
  | { lat: number; lng: number }
  | { latitude: number; longitude: number }
);

export function rowToToken(row: TokenRow): Token {
  const lat = "lat" in row ? row.lat : row.latitude;
  const lng = "lng" in row ? row.lng : row.longitude;
  return { id: row.id, lat, lng, status: row.status, organization_id: row.organization_id ?? null };
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
