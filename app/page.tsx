"use client";

import  MapView  from "@/components/map-view";

export default function Home() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <MapView />
      <aside className="absolute left-4 top-4 z-10 w-64 rounded-lg border border-emerald-500/30 bg-black/90 p-4 shadow-lg shadow-emerald-500/5 backdrop-blur-sm">
        <h2 className="mb-3 font-mono text-xs font-medium uppercase tracking-wider text-emerald-500/80">
          Control Panel
        </h2>
        <dl className="space-y-2 font-mono text-sm">
          <div className="flex justify-between">
            <dt className="text-emerald-400/90">Total Yield</dt>
            <dd className="font-semibold tabular-nums text-emerald-300">
              $3,240.00
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-emerald-400/90">Active Tokens</dt>
            <dd className="font-semibold tabular-nums text-emerald-300">10</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
