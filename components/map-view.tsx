"use client";

import { useEffect, useState } from "react";
import Map, { Marker } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Token } from "@/types";
import { rowToToken, type TokenRow } from "@/types";

const AUSTIN_UT_TOWER = {
  longitude: -97.7341,
  latitude: 30.2849,
  zoom: 15,
} as const;

const PIN_COLORS = {
  active: "#10b981",
  found: "#6b7280",
} as const;

export function MapView() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const { data, error } = await supabase.from("tokens").select("*");
      if (error) {
        console.error("Failed to fetch tokens:", error);
        return;
      }
      setTokens((data ?? []).map((row: TokenRow) => rowToToken(row)));
    };

    load();

    const channel = supabase
      .channel("tokens-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tokens" },
        (payload: { new: TokenRow }) => {
          const next = payload.new;
          if (next.status !== "found") return;
          setTokens((prev) =>
            prev.map((t) =>
              t.id === next.id ? rowToToken(next) : t
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (!mapboxToken) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-emerald-400">
        <p className="text-sm">
          Set <code className="rounded bg-zinc-800 px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> in your environment.
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 h-full w-full">
      <Map
        mapboxAccessToken={mapboxToken}
        initialViewState={{
          ...AUSTIN_UT_TOWER,
          longitude: AUSTIN_UT_TOWER.longitude,
          latitude: AUSTIN_UT_TOWER.latitude,
          zoom: AUSTIN_UT_TOWER.zoom,
        }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
      >
        {tokens.map((t) => (
          <Marker key={t.id} longitude={t.lng} latitude={t.lat} anchor="bottom">
            <MapPin
              size={28}
              strokeWidth={2}
              className="drop-shadow-lg"
              style={{ color: PIN_COLORS[t.status], fill: PIN_COLORS[t.status] }}
            />
          </Marker>
        ))}
      </Map>
    </div>
  );
}
