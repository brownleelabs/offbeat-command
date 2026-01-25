"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

type Phase = "verifying" | "success";

export default function ClaimPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const [phase, setPhase] = useState<Phase>("verifying");

  useEffect(() => {
    if (!id) return;

    const supabase = createClient();

    const run = async () => {
      await supabase.from("tokens").update({ status: "found" }).eq("id", id);
    };

    run();

    const t = setTimeout(() => setPhase("success"), 2000);
    return () => clearTimeout(t);
  }, [id]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black font-mono text-emerald-400">
      {phase === "verifying" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
          <p className="text-lg">Verifying Chip...</p>
        </>
      )}
      {phase === "success" && (
        <p className="text-xl font-semibold text-emerald-300">
          Success: $25.00 Sent
        </p>
      )}
    </div>
  );
}
