'use client'

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { resetDemo } from "@/app/actions";

export default function FleetPage() {
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);

  async function loadFleet() {
    const supabase = createClient();
    const { data } = await supabase
      .from('tokens')
      .select('*')
      .order('id', { ascending: true });
    if (data) setTokens(data);
    setLoading(false);
  }

  useEffect(() => {
    loadFleet();
  }, []);

  const handleReset = async () => {
    setIsResetting(true);
    await resetDemo();
    await loadFleet();
    setIsResetting(false);
  };

  return (
    <div className="p-8 bg-black min-h-screen text-white font-sans">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-green-500 tracking-tighter uppercase">Fleet Command</h1>
        <button 
          onClick={handleReset}
          disabled={isResetting}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-xs font-bold uppercase transition-all disabled:opacity-50"
        >
          {isResetting ? "Resetting..." : "Reset All Assets"}
        </button>
      </div>
      
      <div className="border border-white/10 rounded-lg overflow-hidden bg-zinc-900/30">
        <table className="w-full text-left">
          <thead className="bg-white/5 text-zinc-500 text-[10px] uppercase tracking-widest">
            <tr>
              <th className="p-4">Asset ID</th>
              <th className="p-4">Status</th>
              <th className="p-4">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {tokens.map((token) => (
              <tr key={token.id} className="hover:bg-white/5">
                <td className="p-4 font-mono text-sm">{token.id.slice(-4)}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    token.status === 'active' ? 'bg-green-500 text-black' : 'bg-zinc-700 text-zinc-400'
                  }`}>
                    {token.status}
                  </span>
                </td>
                <td className="p-4 font-mono text-zinc-400">${(token.val_usd / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}