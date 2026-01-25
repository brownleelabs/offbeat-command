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
