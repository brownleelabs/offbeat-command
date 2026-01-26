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

/** Campaign (survey) stored in Supabase. */
export interface Campaign {
  id: string;
  name: string;
  created_at?: string;
  /** Up to 10 questions; stored as JSONB in DB. */
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
