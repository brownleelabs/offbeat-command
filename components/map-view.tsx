"use client";

import Map, { Marker } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, RefreshCw, Activity } from "lucide-react";
import type { Token } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useDashboard } from "@/components/dashboard-context";
import { resetDemo } from "@/app/actions";

const INITIAL_VIEW_STATE = {
  longitude: -97.7341,
  latitude: 30.2849,
  zoom: 15,
};

/** Single built-in style; avoids custom/composite layer issues. */
const MAP_STYLE = "mapbox://styles/mapbox/light-v11";

interface MapViewProps {
  readOnly?: boolean;
  orgId?: string | null;
  mapboxToken?: string | null;
  canReset?: boolean;
}

export default function MapView({
  readOnly = false,
  orgId: orgIdOverride,
  mapboxToken: mapboxTokenProp,
  canReset = true,
}: MapViewProps = {}) {
  const dashboard = useDashboard();
  const orgId = orgIdOverride != null ? orgIdOverride : dashboard.orgId;

  const [tokens, setTokens] = useState<Token[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isReseting, setIsReseting] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const [tokenFromApi, setTokenFromApi] = useState<string>("");
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fromPropOrEnv =
      mapboxTokenProp ??
      (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : "") ??
      "";
    if (fromPropOrEnv) return;
    let cancelled = false;
    fetch("/api/mapbox-token")
      .then((r) => r.json())
      .then((data: { token?: string }) => {
        if (!cancelled && data?.token) setTokenFromApi(data.token);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mapboxTokenProp]);

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
  const fetchTokens = useCallback(async () => {
    const client = createClient();
    let query = client.from("tokens").select("*");
    if (orgId != null) {
      query = query.eq("organization_id", orgId);
    }
    const { data } = await query;
    if (data) setTokens(data as Token[]);
  }, [orgId]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

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

  const mapboxToken =
    mapboxTokenProp ??
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined) ??
    tokenFromApi ??
    "";
  const canShowMap = !!mapboxToken && containerReady;

  return (
    <div className="relative w-full flex-1 min-h-[400px] bg-background" style={{ height: "100%", minHeight: 400 }}>
      <div
        ref={mapContainerRef}
        className="absolute inset-0 w-full bg-zinc-200"
        style={{ minHeight: 480, height: "100%" }}
      >
        {canShowMap ? (
          <Map
            key={mapboxToken.slice(0, 10)}
            initialViewState={INITIAL_VIEW_STATE}
            mapboxAccessToken={mapboxToken}
            mapStyle={MAP_STYLE}
            style={{ width: "100%", height: "100%", minHeight: 480 }}
            attributionControl={true}
            onLoad={(e) => e.target.resize()}
          >
            {tokens.map((t) => (
              <Marker key={t.id} longitude={t.lng} latitude={t.lat}>
                <div
                  className={`p-2 rounded-full transition-all duration-500 ${
                    t.status === "active"
                      ? "bg-primary animate-pulse shadow-[0_0_15px var(--primary)]"
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
              Map needs a token: set <code className="rounded bg-muted px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
              <code className="rounded bg-muted px-1">.env.local</code> and restart dev server.
            </p>
          </div>
        )}
      </div>

      <div className="absolute top-4 left-4 z-50 flex flex-col gap-4 w-80">
        <div className="bg-background/95 backdrop-blur-md border border-accent p-4 rounded-xl shadow-2xl">
          <h2 className="text-muted-foreground text-xs font-bold tracking-widest uppercase mb-2">
            Command Center
          </h2>
          <div className="flex justify-between items-end">
            <div>
              <div className="text-3xl font-mono text-foreground font-bold">
                ${(tokens.filter((t) => t.status === "found").length * 25).toFixed(2)}
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

        <div className="bg-background/95 backdrop-blur-md border border-accent p-4 rounded-xl shadow-2xl max-h-40 overflow-hidden">
          <div className="flex items-center gap-2 text-primary text-xs font-bold tracking-widest uppercase mb-2">
            <Activity className="w-3 h-3 text-primary" />
            Live Feed
          </div>
          <div className="flex flex-col gap-1">
            {logs.length === 0 && (
              <span className="text-muted-foreground text-xs italic">Waiting for signal...</span>
            )}
            {logs.slice(0, 3).map((log, i) => (
              <div key={i} className="text-success text-xs font-mono animate-in slide-in-from-left fade-in">
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!readOnly && canReset && (
        <div className="absolute bottom-8 right-8 z-50">
          <button
            onClick={handleReset}
            disabled={isReseting}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-full font-bold hover:scale-105 active:scale-95 transition-all disabled:opacity-50 shadow-[0_0_20px var(--primary)]"
          >
            <RefreshCw className={`w-4 h-4 ${isReseting ? "animate-spin" : ""}`} />
            {isReseting ? "Reloading Grid..." : "Reset Simulation"}
          </button>
        </div>
      )}
    </div>
  );
}
