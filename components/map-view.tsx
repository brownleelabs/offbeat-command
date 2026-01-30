"use client";

import Map, { Marker, Source, Layer, type MapRef } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Activity, Maximize2, Locate, Info, Download } from "lucide-react";
import type { Token } from "@/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Supercluster from "supercluster";
import { createClient } from "@/lib/supabase";
import { useDashboard } from "@/components/dashboard-context";
import { listTokensForMap, getMapAnalytics, type MapTokenRow } from "@/app/fleet/fleet-actions";

const INITIAL_VIEW_STATE = {
  longitude: -97.7341,
  latitude: 30.2849,
  zoom: 15,
};

/** Map always uses dark style. */
const DEFAULT_MAP_STYLE_DARK = "mapbox://styles/mapbox/dark-v11";

/** Redemption amount shown in Live Feed (USD). */
const REDEMPTION_AMOUNT = 25;

/**
 * Scalable color palette for map legend and org-colored markers.
 * 24 distinct colors tuned for visibility on dark map; same org always gets same color via hash.
 * Add more hex codes here if you need to scale beyond 24 entities.
 */
const MAP_LEGEND_PALETTE: readonly string[] = [
  "#22c55e", // green (primary-like)
  "#3b82f6", // blue
  "#f97316", // orange
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#eab308", // yellow
  "#ef4444", // red
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#84cc16", // lime
  "#f43f5e", // rose
  "#0ea5e9", // sky
  "#d946ef", // fuchsia
  "#e879f9", // pink-400
  "#2dd4bf", // teal-400
  "#fbbf24", // amber-400
  "#fb923c", // orange-300
  "#4ade80", // green-400
  "#60a5fa", // blue-400
  "#c084fc", // purple-400
  "#34d399", // emerald-400
  "#f472b6", // pink-300
];

const MAP_LEGEND_PALETTE_LEN = MAP_LEGEND_PALETTE.length;

/** Index for a given org (stable hash). Use modulo so legend scales with palette size. */
function hashOrgToIndex(orgId: string | null): number {
  if (!orgId) return 0;
  const h = orgId.split("").reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0);
  return Math.abs(h) % MAP_LEGEND_PALETTE_LEN;
}

/** Hex color for an org (for markers and legend). */
function getOrgColor(orgId: string | null, active: boolean): string {
  const hex = MAP_LEGEND_PALETTE[hashOrgToIndex(orgId)] ?? "#6b7280";
  if (active) return hex;
  // Dimmed for "claimed": blend toward gray so it stays distinguishable
  return hex;
}

/** Inline style for org marker background (scalable; works for any palette size). */
function getOrgMarkerStyle(
  orgId: string | null,
  active: boolean
): { backgroundColor: string; boxShadow?: string; opacity?: number } {
  const hex = getOrgColor(orgId, active);
  if (active) {
    return { backgroundColor: hex, boxShadow: `0 0 15px ${hex}cc` };
  }
  return { backgroundColor: hex, opacity: 0.5 };
}

/** Icon color: white for contrast on saturated marker backgrounds. */
const MAP_MARKER_ICON_FG = "text-white";

/** Detect style/source/layer errors so we can fall back to default style. */
function isStyleLayerError(message: string): boolean {
  return (
    message.includes("does not exist") ||
    message.includes("Source layer") ||
    message.includes("as specified by style layer") ||
    message.includes("on source \"composite\"")
  );
}

function applyStyleErrorFallback(
  styleErrorHandled: { current: boolean },
  hasFittedInitial: { current: boolean },
  setMapReady: (v: boolean) => void,
  setEffectiveMapStyle: (v: string) => void
): void {
  if (styleErrorHandled.current) return;
  styleErrorHandled.current = true;
  hasFittedInitial.current = false;
  setMapReady(false);
  setEffectiveMapStyle(DEFAULT_MAP_STYLE_DARK);
}

export type MapViewOrganization = { id: string; name: string };
export type MapViewCampaign = { id: string; name: string };

interface MapViewProps {
  readOnly?: boolean;
  orgId?: string | null;
  mapboxToken?: string | null;
  onTokenClick?: (tokenId: string) => void;
  organizations?: MapViewOrganization[];
  campaigns?: MapViewCampaign[];
  selectedCampaignId?: string | null;
  onCampaignChange?: (campaignId: string | null) => void;
  selectedOrgId?: string | null;
  onOrgChange?: (orgId: string | null) => void;
}

export default function MapView({
  readOnly = false,
  orgId: orgIdOverride,
  mapboxToken: mapboxTokenProp,
  onTokenClick,
  organizations = [],
  campaigns = [],
  selectedCampaignId = null,
  onCampaignChange,
  selectedOrgId: selectedOrgIdProp = null,
  onOrgChange,
}: MapViewProps = {}) {
  const dashboard = useDashboard();
  const isSuperAdmin = dashboard.userRole === "SUPER_ADMIN";
  // Use override only when explicitly passed (e.g. /schools/[slug]). Otherwise use dataScopeOrgId
  // and preserve null (AUDITOR / SUPER_ADMIN GLOBAL = see all); do not fall back to orgId.
  const orgId =
    orgIdOverride != null ? orgIdOverride : dashboard.dataScopeOrgId;

  const [tokens, setTokens] = useState<MapTokenRow[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [containerReady, setContainerReady] = useState(false);
  const [tokenFromApi, setTokenFromApi] = useState<string>("");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef>(null);
  const legendPopoverRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [effectiveMapStyle, setEffectiveMapStyle] = useState(DEFAULT_MAP_STYLE_DARK);
  const styleErrorHandled = useRef(false);
  const hasFittedInitial = useRef(false);
  const [justFoundIds, setJustFoundIds] = useState<Set<string>>(new Set());
  const [newTokenIds, setNewTokenIds] = useState<Set<string>>(new Set());
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "found">("all");
  const [timeFilter, setTimeFilter] = useState<"all" | "24h" | "7d">("all");
  void setTimeFilter; // reserved for future time filter UI
  const showHeatmap = true;
  const useClustering = true;
  const [showLegendPopover, setShowLegendPopover] = useState(false);
  const [mapViewState, setMapViewState] = useState<{ bounds: [number, number, number, number] | null; zoom: number }>({ bounds: null, zoom: INITIAL_VIEW_STATE.zoom });
  const [analytics, setAnalytics] = useState<{ total: number; found: number; redemptionRate: number; claimsLast7Days: number } | null>(null);

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
    setMapError(null);
    setMapLoading(true);
    try {
      const res = await listTokensForMap(orgId ?? undefined);
      if (res.success) {
        const list = Array.isArray(res.tokens) ? res.tokens : [];
        setTokens(list as MapTokenRow[]);
      } else {
        setMapError(res.error ?? "Failed to load map.");
        setTokens([]);
      }
    } finally {
      setMapLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  useEffect(() => {
    let cancelled = false;
    getMapAnalytics(orgId ?? undefined).then((res) => {
      if (!cancelled && res.success) {
        setAnalytics({ total: res.total, found: res.found, redemptionRate: res.redemptionRate, claimsLast7Days: res.claimsLast7Days });
      }
    });
    return () => { cancelled = true; };
  }, [orgId]);

  useEffect(() => {
    hasFittedInitial.current = false;
  }, [orgId]);

  useEffect(() => {
    const channel = supabase
      .channel("map-live")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tokens" },
        (payload: { new: Token & { organization_id?: string | null; campaign_id?: string | null; redeemed_at?: string | null } }) => {
          const newItem = payload.new;
          if (!newItem?.id || typeof newItem.id !== "string") return;
          if (orgId != null && newItem.organization_id !== orgId) return;
          const lat = Number(newItem.lat);
          const lng = Number(newItem.lng);
          const status = newItem.status === "found" ? "found" : "active";
          const token: MapTokenRow = {
            id: newItem.id,
            lat: Number.isFinite(lat) ? lat : 0,
            lng: Number.isFinite(lng) ? lng : 0,
            status,
            organization_id: newItem.organization_id ?? null,
            campaign_id: newItem.campaign_id ?? null,
            redeemed_at: typeof newItem.redeemed_at === "string" ? newItem.redeemed_at : null,
          };
          setTokens((prev) =>
            prev.map((t) => (t.id === token.id ? token : t))
          );
          if (token.status === "found") {
            setJustFoundIds((prev) => new Set(prev).add(token.id));
            setTimeout(() => {
              setJustFoundIds((prev) => {
                const next = new Set(prev);
                next.delete(token.id);
                return next;
              });
            }, 1500);
            const time = new Date().toLocaleTimeString();
            setLogs((prev) => [`[${time}] Asset ...${token.id.slice(-4)} FOUND — $25 redeemed`, ...prev]);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tokens" },
        (payload: { new: Token & { organization_id?: string | null; campaign_id?: string | null; redeemed_at?: string | null } }) => {
          const newItem = payload.new;
          if (!newItem?.id || typeof newItem.id !== "string") return;
          if (orgId != null && newItem.organization_id !== orgId) return;
          const lat = Number(newItem.lat);
          const lng = Number(newItem.lng);
          const status = newItem.status === "found" ? "found" : "active";
          const token: MapTokenRow = {
            id: newItem.id,
            lat: Number.isFinite(lat) ? lat : 0,
            lng: Number.isFinite(lng) ? lng : 0,
            status,
            organization_id: newItem.organization_id ?? null,
            campaign_id: newItem.campaign_id ?? null,
            redeemed_at: typeof newItem.redeemed_at === "string" ? newItem.redeemed_at : null,
          };
          setTokens((prev) => [...prev, token]);
          setNewTokenIds((prev) => new Set(prev).add(token.id));
          setTimeout(() => {
            setNewTokenIds((prev) => {
              const next = new Set(prev);
              next.delete(token.id);
              return next;
            });
          }, 800);
          const time = new Date().toLocaleTimeString();
          setLogs((prev) => [`[${time}] Asset ...${token.id.slice(-4)} added`, ...prev]);
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
        (payload: {
          new: {
            token_id?: string;
            organization_id?: string | null;
            first_name?: string | null;
            last_name?: string | null;
            student_email?: string | null;
            student_id?: string | null;
            venmo_username?: string | null;
          };
        }) => {
          const row = payload.new;
          if (orgId != null && row.organization_id !== orgId) return;
          const tokenId = (row.token_id ?? "").slice(-4);
          const time = new Date().toLocaleTimeString();
          const first = String(row.first_name ?? "").trim();
          const last = String(row.last_name ?? "").trim();
          const email = String(row.student_email ?? "").trim();
          const venmo = String(row.venmo_username ?? "").trim();
          const studentId = String(row.student_id ?? "").trim();
          const hasKyc = first || last || email || venmo || studentId;
          const line = hasKyc
            ? `[${time}] ${[first, last].filter(Boolean).join(" ") || "—"} | ${email || "—"} | ${venmo ? `@${venmo}` : "—"} | ${studentId ? `ID ${studentId}` : "—"} | $${REDEMPTION_AMOUNT} redeemed`
            : `[${time}] Claim submitted ...${tokenId} | $${REDEMPTION_AMOUNT} redeemed`;
          setLogs((prev) => [line, ...prev]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // supabase from createClient() - stable ref not needed for cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const displayTokens = useMemo(() => {
    let list = statusFilter === "all" ? tokens : tokens.filter((t) => t.status === statusFilter);
    if (timeFilter === "24h" || timeFilter === "7d") {
      const hours = timeFilter === "24h" ? 24 : 168;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      list = list.filter((t) => t.status === "found" && t.redeemed_at != null && t.redeemed_at >= since);
    }
    if (selectedCampaignId != null && selectedCampaignId !== "") {
      list = list.filter((t) => t.campaign_id === selectedCampaignId);
    }
    return list;
  }, [tokens, statusFilter, timeFilter, selectedCampaignId]);

  const fitBoundsToTokens = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || displayTokens.length === 0) return;
    const lngs = displayTokens.map((t) => t.lng);
    const lats = displayTokens.map((t) => t.lat);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    if (minLng === maxLng && minLat === maxLat) {
      map.flyTo({ center: [minLng, minLat], zoom: 15, duration: 0 });
      return;
    }
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80 }
    );
  }, [displayTokens]);

  const handleExportVisible = useCallback((format: "csv" | "geojson") => {
    const map = mapRef.current?.getMap();
    if (!map || displayTokens.length === 0) return;
    const bounds = map.getBounds();
    if (!bounds) return;
    const west = bounds.getWest();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const north = bounds.getNorth();
    const inView = displayTokens.filter(
      (t) => t.lng >= west && t.lng <= east && t.lat >= south && t.lat <= north
    );
    if (format === "csv") {
      const header = "id,lat,lng,status,organization_id,campaign_id,redeemed_at";
      const rows = inView.map((t) =>
        [t.id, t.lat, t.lng, t.status, t.organization_id ?? "", t.campaign_id ?? "", t.redeemed_at ?? ""].join(",")
      );
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `map-tokens-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const geojson = {
        type: "FeatureCollection" as const,
        features: inView.map((t) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [t.lng, t.lat] },
          properties: { id: t.id, status: t.status, organization_id: t.organization_id, campaign_id: t.campaign_id, redeemed_at: t.redeemed_at },
        })),
      };
      const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `map-tokens-${new Date().toISOString().slice(0, 10)}.geojson`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [displayTokens]);

  const clusterPoints = useMemo(
    () =>
      displayTokens.map((t) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [t.lng, t.lat] as [number, number] },
        properties: { id: t.id },
      })),
    [displayTokens]
  );
  const clusterIndex = useMemo(() => {
    const index = new Supercluster({ radius: 60, maxZoom: 16 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    index.load(clusterPoints as any);
    return index;
  }, [clusterPoints]);
  const clusters = useMemo(() => {
    if (!useClustering || !mapViewState.bounds) return [];
    return clusterIndex.getClusters(mapViewState.bounds, Math.floor(mapViewState.zoom));
  }, [useClustering, mapViewState.bounds, mapViewState.zoom, clusterIndex]);

  const heatmapData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: displayTokens.map((t) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [t.lng, t.lat] as [number, number] },
        properties: {},
      })),
    }),
    [displayTokens]
  );

  useEffect(() => {
    if (!showLegendPopover) return;
    const onDocClick = (e: MouseEvent) => {
      if (legendPopoverRef.current?.contains(e.target as Node)) return;
      setShowLegendPopover(false);
    };
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [showLegendPopover]);

  const handleMyLocation = useCallback(() => {
    setGeoMessage(null);
    if (!navigator.geolocation) {
      setGeoMessage("Location unavailable in this browser.");
      setTimeout(() => setGeoMessage(null), 4000);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        const { longitude, latitude } = pos.coords;
        map.flyTo({ center: [longitude, latitude], zoom: 15, duration: 800 });
        setGeoMessage(null);
      },
      (err) => {
        const msg =
          err.code === 1
            ? "Location permission denied."
            : err.code === 2
              ? "Location unavailable."
              : "Could not get your location.";
        setGeoMessage(msg);
        setTimeout(() => setGeoMessage(null), 5000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    if (!mapReady || displayTokens.length === 0 || hasFittedInitial.current) return;
    hasFittedInitial.current = true;
    fitBoundsToTokens();
  }, [mapReady, displayTokens.length, fitBoundsToTokens]);

  const mapboxToken =
    mapboxTokenProp ??
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined) ??
    tokenFromApi ??
    "";
  const canShowMap = !!mapboxToken && containerReady;
  const showEmptyState = !mapLoading && !mapError && tokens.length === 0;
  const multiOrg = orgId == null && organizations.length > 0;
  const orgIdsInView = Array.from(
    new Set(displayTokens.map((t) => t.organization_id).filter(Boolean) as string[])
  );
  const hasActiveInView = displayTokens.some((t) => t.status === "active");
  const hasFoundInView = displayTokens.some((t) => t.status === "found");
  const orgName = (id: string | null) =>
    id ? organizations.find((o) => o.id === id)?.name ?? id.slice(0, 8) : "—";

  return (
    <div className="relative w-full flex-1 min-h-[400px] bg-background" style={{ height: "100%", minHeight: 400 }}>
      {mapLoading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <p className="text-muted-foreground font-medium">Loading map…</p>
        </div>
      )}
      {mapError && (
        <div className="absolute top-4 left-1/2 z-40 -translate-x-1/2 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 max-w-md">
          <p className="text-sm text-destructive">{mapError}</p>
          <button
            type="button"
            onClick={() => fetchTokens()}
            className="rounded border border-destructive/50 bg-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/30"
            aria-label="Retry loading map"
          >
            Retry
          </button>
        </div>
      )}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 w-full bg-zinc-200"
        style={{ minHeight: 480, height: "100%" }}
      >
        {canShowMap ? (
          <Map
            ref={mapRef}
            key={`${mapboxToken.slice(0, 10)}-${effectiveMapStyle.slice(0, 40)}`}
            initialViewState={INITIAL_VIEW_STATE}
            mapboxAccessToken={mapboxToken}
            mapStyle={effectiveMapStyle}
            style={{ width: "100%", height: "100%", minHeight: 480 }}
            attributionControl={true}
            onError={(evt: { error?: { message?: string } }) => {
              const msg = evt.error?.message ?? "";
              if (isStyleLayerError(msg)) {
                applyStyleErrorFallback(
                  styleErrorHandled,
                  hasFittedInitial,
                  setMapReady,
                  setEffectiveMapStyle
                );
              }
            }}
            onMoveEnd={() => {
              const map = mapRef.current?.getMap();
              if (map) {
                const b = map.getBounds();
                setMapViewState({
                  bounds: b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null,
                  zoom: map.getZoom(),
                });
              }
            }}
            onLoad={(e) => {
              const map = mapRef.current?.getMap();
              if (map) {
                const b = map.getBounds();
                setMapViewState((prev) => ({
                  ...prev,
                  bounds: b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null,
                  zoom: map.getZoom(),
                }));
                map.on("error", (evt: { error?: { message?: string } }) => {
                  const msg = evt.error?.message ?? "";
                  if (isStyleLayerError(msg)) {
                    applyStyleErrorFallback(
                      styleErrorHandled,
                      hasFittedInitial,
                      setMapReady,
                      setEffectiveMapStyle
                    );
                  }
                });
              }
              e.target.resize();
              setMapReady(true);
            }}
          >
            {showHeatmap && (
              <Source id="map-heatmap-source" type="geojson" data={heatmapData}>
                <Layer
                  id="map-heatmap-layer"
                  type="heatmap"
                  paint={{
                    "heatmap-weight": 1,
                    "heatmap-intensity": 0.8,
                    "heatmap-radius": 20,
                    "heatmap-opacity": 0.5,
                    "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.5, "rgba(59,130,246,0.5)", 1, "rgba(59,130,246,0.8)"],
                  }}
                />
              </Source>
            )}
            {useClustering && clusters.length > 0
              ? clusters.map((cluster) => {
                  const [lng, lat] = cluster.geometry.coordinates;
                  const { cluster: isCluster, point_count: pointCount } = cluster.properties as { cluster?: boolean; point_count?: number };
                  if (isCluster && pointCount != null) {
                    const clusterId = (cluster.properties as { cluster_id?: number }).cluster_id;
                    return (
                      <Marker key={`cluster-${cluster.id ?? clusterId}`} longitude={lng} latitude={lat} anchor="center">
                        <button
                          type="button"
                          onClick={() => {
                            const map = mapRef.current?.getMap();
                            if (map && clusterId != null) {
                              const zoom = clusterIndex.getClusterExpansionZoom(clusterId);
                              map.flyTo({ center: [lng, lat], zoom, duration: 300 });
                            }
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary bg-primary/80 text-xs font-bold text-primary-foreground shadow-lg hover:bg-primary"
                          aria-label={`${pointCount} assets clustered`}
                        >
                          {pointCount}
                        </button>
                      </Marker>
                    );
                  }
                  const tokenId = (cluster.properties as { id?: string }).id;
                  const t = displayTokens.find((tok) => tok.id === tokenId);
                  if (!t) return null;
                  const active = t.status === "active";
                  const justFound = justFoundIds.has(t.id);
                  const isNew = newTokenIds.has(t.id);
                  const useScalablePalette = multiOrg;
                  const markerStyle = useScalablePalette ? getOrgMarkerStyle(t.organization_id, active) : undefined;
                  const bgClass = useScalablePalette
                    ? ""
                    : active ? "bg-primary animate-pulse shadow-[0_0_15px_var(--primary)]" : "bg-muted opacity-50";
                  const fgClass = useScalablePalette ? MAP_MARKER_ICON_FG : (active ? "text-primary-foreground" : "text-muted-foreground");
                  return (
                    <Marker key={t.id} longitude={t.lng} latitude={t.lat} anchor="bottom">
                      <button
                        type="button"
                        onClick={() => onTokenClick?.(t.id)}
                        style={markerStyle}
                        className={`cursor-pointer rounded-full p-2 transition-all duration-500 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${active ? "animate-pulse hover:scale-110" : "hover:opacity-70"} ${bgClass} ${onTokenClick ? "" : "pointer-events-none"} ${justFound ? "ring-2 ring-green-400 ring-offset-2 ring-offset-background scale-110" : ""} ${isNew ? "animate-in fade-in zoom-in-95 duration-300" : ""}`}
                        aria-label={`Asset ${t.id.slice(-4)}, ${active ? "unclaimed" : "claimed"}`}
                      >
                        <MapPin className={`w-6 h-6 ${fgClass}`} />
                      </button>
                    </Marker>
                  );
                })
              : displayTokens.map((t) => {
              const active = t.status === "active";
              const justFound = justFoundIds.has(t.id);
              const isNew = newTokenIds.has(t.id);
              const useScalablePalette = multiOrg;
              const markerStyle = useScalablePalette ? getOrgMarkerStyle(t.organization_id, active) : undefined;
              const bgClass = useScalablePalette
                ? ""
                : active ? "bg-primary animate-pulse shadow-[0_0_15px_var(--primary)]" : "bg-muted opacity-50";
              const fgClass = useScalablePalette ? MAP_MARKER_ICON_FG : (active ? "text-primary-foreground" : "text-muted-foreground");
              return (
                <Marker key={t.id} longitude={t.lng} latitude={t.lat} anchor="bottom">
                  <button
                    type="button"
                    onClick={() => onTokenClick?.(t.id)}
                    style={markerStyle}
                    className={`cursor-pointer rounded-full p-2 transition-all duration-500 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${active ? "animate-pulse hover:scale-110" : "hover:opacity-70"} ${bgClass} ${onTokenClick ? "" : "pointer-events-none"} ${justFound ? "ring-2 ring-green-400 ring-offset-2 ring-offset-background scale-110" : ""} ${isNew ? "animate-in fade-in zoom-in-95 duration-300" : ""}`}
                    aria-label={`Asset ${t.id.slice(-4)}, ${active ? "unclaimed" : "claimed"}`}
                  >
                    <MapPin className={`w-6 h-6 ${fgClass}`} />
                  </button>
                </Marker>
              );
            })}
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

      {showEmptyState && canShowMap && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60">
          <p className="text-muted-foreground text-sm max-w-md text-center px-4">
            No assets in this scope. Add tokens in Fleet or switch organization.
          </p>
        </div>
      )}

      <div className="absolute top-4 left-4 z-50 flex flex-col gap-4 w-80">
        {analytics != null && (
          <div className="bg-background/95 backdrop-blur-md border border-accent p-3 rounded-xl shadow-2xl" role="group" aria-label="Map analytics">
            <div className="text-muted-foreground text-xs font-bold tracking-widest uppercase mb-2">Analytics</div>
            <div className="grid grid-cols-1 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Tokens Available to Mint</span>
                <div className="font-mono font-semibold">—</div>
              </div>
              <div>
                <span className="text-muted-foreground">Total Unclaimed Assets</span>
                <div className="font-mono font-semibold">{analytics.total - analytics.found}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Total Claimed Assets</span>
                <div className="font-mono font-semibold">{analytics.found}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Redemption rate</span>
                <div className="font-mono font-semibold">{analytics.redemptionRate}%</div>
              </div>
            </div>
          </div>
        )}

        <div
          className="bg-background/95 backdrop-blur-md border border-accent p-4 rounded-xl shadow-2xl max-h-40 overflow-hidden"
          aria-live="polite"
          aria-label="Live feed of asset and claim events"
        >
          <div className="flex items-center gap-2 text-primary text-xs font-bold tracking-widest uppercase mb-2">
            <Activity className="w-3 h-3 text-primary" />
            Live Feed
          </div>
          <div className="flex flex-col gap-1">
            {logs.length === 0 && (
              <span className="text-muted-foreground text-xs italic">Waiting for signal...</span>
            )}
            {logs.slice(0, 5).map((log, i) => (
              <div key={i} className="text-success text-xs font-mono animate-in slide-in-from-left fade-in">
                {log}
              </div>
            ))}
          </div>
        </div>

        <div className="relative" ref={legendPopoverRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowLegendPopover((v) => !v);
            }}
            className="flex items-center gap-2 w-full rounded-xl border border-accent bg-background/95 backdrop-blur-md p-3 shadow-2xl text-left"
            aria-label="Show map legend"
            aria-expanded={showLegendPopover}
          >
            <Info className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground text-xs font-bold tracking-widest uppercase">Legend</span>
          </button>
          {showLegendPopover && (
            <div
              className="absolute top-full left-0 mt-1 z-[60] min-w-[12rem] max-h-[min(16rem,60vh)] overflow-y-auto rounded-xl border border-accent bg-background/98 backdrop-blur-md p-3 shadow-2xl"
              role="group"
              aria-label="Map legend: statuses and organizations currently on the map"
            >
              <div className="flex flex-col gap-1.5 text-xs">
                {displayTokens.length === 0 ? (
                  <p className="text-muted-foreground">No assets in view.</p>
                ) : (
                  <>
                    {hasActiveInView && (
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" aria-hidden />
                        <span>Unclaimed</span>
                      </div>
                    )}
                    {hasFoundInView && (
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-muted opacity-50" aria-hidden />
                        <span>Claimed</span>
                      </div>
                    )}
                    {multiOrg && orgIdsInView.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-accent space-y-1">
                        <span className="text-muted-foreground font-semibold">Organizations</span>
                        {orgIdsInView.map((oid) => (
                          <div key={oid} className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{
                                backgroundColor:
                                  MAP_LEGEND_PALETTE[hashOrgToIndex(oid)] ?? "#6b7280",
                              }}
                              aria-hidden
                            />
                            <span className="truncate">{orgName(oid)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="bg-background/95 backdrop-blur-md border border-accent p-3 rounded-xl shadow-2xl" role="group" aria-label="Filter by status">
          <div className="text-muted-foreground text-xs font-bold tracking-widest uppercase mb-2">Status</div>
          <div className="flex flex-wrap gap-1">
            {(["all", "active", "found"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  statusFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
                aria-pressed={statusFilter === f}
                aria-label={f === "all" ? "Show all assets" : f === "active" ? "Show only unclaimed" : "Show only claimed"}
              >
                {f === "all" ? "All" : f === "active" ? "Unclaimed" : "Claimed"}
              </button>
            ))}
          </div>
        </div>
        {campaigns.length > 0 && (
          <div className="bg-background/95 backdrop-blur-md border border-accent p-3 rounded-xl shadow-2xl" role="group" aria-label="Campaign filter">
            <div className="text-muted-foreground text-xs font-bold tracking-widest uppercase mb-2">Campaign</div>
            <select
              value={selectedCampaignId ?? ""}
              onChange={(e) => onCampaignChange?.(e.target.value || null)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              aria-label="Filter by campaign"
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        {isSuperAdmin && organizations.length > 0 && (
          <div className="bg-background/95 backdrop-blur-md border border-accent p-3 rounded-xl shadow-2xl" role="group" aria-label="Organization filter">
            <div className="text-muted-foreground text-xs font-bold tracking-widest uppercase mb-2">Org</div>
            <select
              value={selectedOrgIdProp ?? ""}
              onChange={(e) => onOrgChange?.(e.target.value || null)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              aria-label="Filter by organization"
            >
              <option value="">All organizations</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
        {!readOnly && (
          <div className="bg-background/95 backdrop-blur-md border border-accent p-3 rounded-xl shadow-2xl flex gap-1">
            <button
              type="button"
              onClick={() => handleExportVisible("csv")}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium bg-muted/60 hover:bg-muted"
              aria-label="Export visible area as CSV"
            >
              <Download className="w-3 h-3" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => handleExportVisible("geojson")}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium bg-muted/60 hover:bg-muted"
              aria-label="Export visible area as GeoJSON"
            >
              <Download className="w-3 h-3" />
              GeoJSON
            </button>
          </div>
        )}
      </div>

      {geoMessage && (
        <div
          className="absolute bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-300 shadow-lg"
          role="alert"
          aria-live="polite"
        >
          {geoMessage}
        </div>
      )}

      {!readOnly && (
        <div className="absolute bottom-8 right-8 z-50 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleMyLocation}
            aria-label="Center map on my location"
            className="flex items-center gap-2 rounded-full border border-accent bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg hover:bg-muted/80 disabled:opacity-50"
          >
            <Locate className="w-4 h-4" />
            My location
          </button>
          {displayTokens.length > 0 && (
            <>
              <button
                type="button"
                onClick={fitBoundsToTokens}
                aria-label="Fit map to show all assets"
                className="flex items-center gap-2 rounded-full border border-accent bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg hover:bg-muted/80 disabled:opacity-50"
              >
                <Maximize2 className="w-4 h-4" />
                Show all
              </button>
              {selectedCampaignId && (
                <button
                  type="button"
                  onClick={fitBoundsToTokens}
                  aria-label="Fit map to campaign assets"
                  className="flex items-center gap-2 rounded-full border border-accent bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg hover:bg-muted/80"
                >
                  <Maximize2 className="w-4 h-4" />
                  Fit to campaign
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
