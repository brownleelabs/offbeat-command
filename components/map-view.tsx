"use client";

import Map, { Marker } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, RefreshCw, Activity } from "lucide-react";
import type { Token } from "@/types";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useDashboard } from "@/components/dashboard-context";
import { resetDemo } from "@/app/actions";

// STARTING VIEW: UT Austin
const INITIAL_VIEW_STATE = {
  longitude: -97.7341,
  latitude: 30.2849,
  zoom: 15,
};

export default function MapView() {
  const { orgId } = useDashboard();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isReseting, setIsReseting] = useState(false);

  const supabase = createClient();

  // 1. Fetch Initial Data (org-aware)
  useEffect(() => {
    async function fetchTokens() {
      let query = supabase.from("tokens").select("*");
      if (orgId != null) {
        query = query.eq("organization_id", orgId);
      }
      const { data } = await query;
      if (data) setTokens(data as Token[]);
    }
    fetchTokens();
  }, [orgId]);

  // 2. Realtime Listener (only apply updates for current org when orgId set)
  useEffect(() => {
    const channel = supabase
      .channel("tokens-demo")
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  // 3. The Reset Button Handler
  const handleReset = async () => {
    setIsReseting(true);
    await resetDemo(); // Call the Server Action
    setLogs([]); // Clear the logs
    setIsReseting(false);
  };

  return (
    <div className="relative w-full h-screen bg-background">
      {/* --- THE MAP --- */}
      <Map
        initialViewState={INITIAL_VIEW_STATE}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: "100%", height: "100%" }}
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

      {/* 3. BOTTOM RIGHT: The Reset Button */}
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
    </div>
  );
}