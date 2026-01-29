import { NextResponse } from "next/server";

/**
 * Returns the Mapbox public token from server env.
 * Use this when the client doesn't receive NEXT_PUBLIC_MAPBOX_TOKEN (e.g. dynamic import, Turbopack).
 *
 * Intentionally unauthenticated: map access is not RBAC-gated. Only which tokens appear on the map is (via org/role).
 */
export async function GET() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
  return NextResponse.json({ token });
}
