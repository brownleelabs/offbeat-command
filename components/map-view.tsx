"use client";

import Map, { Marker } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, RefreshCw, Activity } from "lucide-react";
import type { Token } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useDashboard } from "@/components/dashboard-context";
import { resetDemo } from "@/app/actions";

// STARTING VIEW: UT Austin
const INITIAL_VIEW_STATE = {
  longitude: -97.7341,
  latitude: 30.2849,
  zoom: 15,
};

interface MapViewProps {
  /** When true, hide admin-only controls (e.g. Reset). Used for public student map. */
  readOnly?: boolean;
  /** When set, fetch tokens for this org instead of using dashboard context. Used for public /schools/[slug]. */
  orgId?: string | null;
  /** Mapbox access token (passed from parent so dynamic import has it). Falls back to NEXT_PUBLIC_MAPBOX_TOKEN. */
  mapboxToken?: string | null;
  /** When false, hide Reset button (e.g. when role has no map_reset permission). Default true. */
  canReset?: boolean;
}

export default function MapView({ readOnly = false, orgId: orgIdOverride, mapboxToken: mapboxTokenProp, canReset = true }: MapViewProps = {}) {
  const dashboard = useDashboard();
  const orgId = orgIdOverride != null ? orgIdOverride : dashboard.orgId;

  const [tokens, setTokens] = useState<Token[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isReseting, setIsReseting] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const check = () => {
      const { width, height } = el.getBoundingClientRect();
      setContainerReady(width > 0 && height >= 200);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const supabase = createClient();

  // Map access: no per-org blocking; every org sees the map. Restriction is which tokens are shown (filter by school/org).
  const fetchTokens = useCallback(async () => {
    const client = createClient();
    let query = client.from("tokens").select("*");
    if (orgId != null) {
      query = query.eq("organization_id", orgId);
    }
    const { data } = await query;
    if (data) setTokens(data as Token[]);
  }, [orgId]);

  // 1. Fetch Initial Data (org-aware)
  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  // 2. Realtime: tokens (status/position) + responses (new claims for Live Feed)
  useEffect(() => {
    const channel = supabase
      .channel("map-live")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tokens" },
        (payload: { new: Token & { organization_id?: string | null } }) => {
          const newItem = payload.new;
          if (orgId != null && newItem.organization_id !== orgId) return;
          const token: Token = {
            id: newItem.id,
            lat: newItem.lat,
            lng: newItem.lng,
            status: newItem.status,
            organization_id: newItem.organization_id ?? null,
          };
          setTokens((prev) =>
            prev.map((t) => (t.id === token.id ? token : t))
          );
          if (token.status === "found") {
            const time = new Date().toLocaleTimeString();
            setLogs((prev) => [`[${time}] Asset ...${token.id.slice(-4)} FOUND`, ...prev]);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "responses",
          ...(orgId ? { filter: `organization_id=eq.${orgId}` } : {}),
        },
        (payload: { new: { token_id?: string; organization_id?: string | null } }) => {
          const row = payload.new;
          if (orgId != null && row.organization_id !== orgId) return;
          const tokenId = (row.token_id ?? "").slice(-4);
          const time = new Date().toLocaleTimeString();
          setLogs((prev) => [`[${time}] Claim submitted ...${tokenId}`, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  const handleReset = async () => {
    setIsReseting(true);
    try {
      await resetDemo(orgId);
      setLogs([]);
      await fetchTokens();
    } finally {
      setIsReseting(false);
    }
  };

  const mapboxToken = mapboxTokenProp ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
  const canShowMap = !!mapboxToken && containerReady;

  return (
    <div className="relative w-full flex-1 min-h-[400px] bg-background" style={{ height: "100%", minHeight: 400 }}>
      {/* Map is available to all orgs; tokens are filtered by school/org (dashboard orgId). */}
      <div ref={mapContainerRef} className="absolute inset-0 w-full" style={{ minHeight: 400, height: "100%" }}>
        {canShowMap ? (
          <Map
            initialViewState={INITIAL_VIEW_STATE}
            mapboxAccessToken={mapboxToken}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            style={{ width: "100%", height: "100%", minHeight: 400 }}
            attributionControl={false}
          >
            {tokens.map((t) => (
              <Marker key={t.id} longitude={t.lng} latitude={t.lat}>
                <div
                  className={`p-2 rounded-full transition-all duration-500 ${
                    t.status === "active"
                      ? "bg-primary animate-pulse shadow-[0_0_15px_var(--primary)]"
                      : "bg-muted opacity-50"
                  }`}
                >
                  <MapPin
                    className={`w-6 h-6 ${
                      t.status === "active" ? "text-primary-foreground" : "text-muted-foreground"
                    }`}
                  />
                </div>
              </Marker>
            ))}
          </Map>
        ) : (
          <div className="flex h-full min-h-[400px] w-full items-center justify-center rounded-lg border border-border bg-muted/30 p-8 text-center">
            <p className="text-muted-foreground">
              Map unavailable: set <code className="rounded bg-muted px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
              <code className="rounded bg-muted px-1">.env.local</code> and restart the dev server.
            </p>
          </div>
        )}
      </div>

      {/* --- UI OVERLAYS --- */}
      
      {/* 1. TOP LEFT: Stats Panel */}
      <div className="absolute top-4 left-4 z-50 flex flex-col gap-4 w-80">
        <div className="bg-background/95 backdrop-blur-md border border-accent p-4 rounded-xl shadow-2xl">
          <h2 className="text-muted-foreground text-xs font-bold tracking-widest uppercase mb-2">
            Command Center
          </h2>
          <div className="flex justify-between items-end">
            <div>
              <div className="text-3xl font-mono text-foreground font-bold">
                ${(tokens.filter(t => t.status === 'found').length * 25).toFixed(2)}
              </div>
              <div className="text-success text-xs mt-1">Total Yield Disbursed</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-mono text-foreground">
                {tokens.filter((t) => t.status === "active").length} / {tokens.length}
              </div>
              <div className="text-muted-foreground text-xs">Active Assets</div>
            </div>
          </div>
        </div>

        {/* 2. LIVE FEED */}
        <div className="bg-background/95 backdrop-blur-md border border-accent p-4 rounded-xl shadow-2xl max-h-40 overflow-hidden">
          <div className="flex items-center gap-2 text-primary text-xs font-bold tracking-widest uppercase mb-2">
            <Activity className="w-3 h-3 text-primary" />
            Live Feed
          </div>
          <div className="flex flex-col gap-1">
            {logs.length === 0 && <span className="text-muted-foreground text-xs italic">Waiting for signal...</span>}
            {logs.slice(0, 3).map((log, i) => (
              <div key={i} className="text-success text-xs font-mono animate-in slide-in-from-left fade-in">
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. BOTTOM RIGHT: The Reset Button (hidden in readOnly or when canReset is false) */}
      {!readOnly && canReset && (
        <div className="absolute bottom-8 right-8 z-50">
          <button
            onClick={handleReset}
            disabled={isReseting}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-full font-bold hover:scale-105 active:scale-95 transition-all disabled:opacity-50 shadow-[0_0_20px_var(--primary)]"
          >
            <RefreshCw className={`w-4 h-4 ${isReseting ? "animate-spin" : ""}`} />
            {isReseting ? "Reloading Grid..." : "Reset Simulation"}
          </button>
        </div>
      )}
    </div>
  );
}