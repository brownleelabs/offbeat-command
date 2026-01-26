/** Strict token type: id, lat, lng, status. */
export interface Token {
  id: string;
  lat: number;
  lng: number;
  status: "active" | "found";
}

/** Row as returned from Supabase (may use latitude/longitude column names). */
export type TokenRow = {
  id: string;
  status: "active" | "found";
} & (
  | { lat: number; lng: number }
  | { latitude: number; longitude: number }
);

export function rowToToken(row: TokenRow): Token {
  const lat = "lat" in row ? row.lat : row.latitude;
  const lng = "lng" in row ? row.lng : row.longitude;
  return { id: row.id, lat, lng, status: row.status };
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

/** Campaign (survey) stored in Supabase. */
export interface Campaign {
  id: string;
  name: string;
  created_at?: string;
  /** Required fields for reward payout; stored as JSONB. */
  required_fields?: CampaignRequiredField[];
  /** Up to 10 custom questions; stored as JSONB in DB. */
  questions?: CampaignQuestion[];
}

export interface CampaignQuestion {
  order: number;
  text: string;
}

/** Token row joined with campaign (for Fleet table). Use select('*, campaigns(name)'). */
export interface TokenWithCampaign extends Token {
  campaign_id?: string | null;
  campaigns: { name: string } | null;
}
