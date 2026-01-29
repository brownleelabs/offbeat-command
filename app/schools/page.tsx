"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

type OrgRow = { id: string; name: string; slug: string };

export default function SchoolsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, slug")
        .eq("type", "school")
        .order("name");
      setOrgs((data as OrgRow[]) ?? []);
    })().finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-8 text-2xl font-bold tracking-tight text-primary">
          We will be live soon! Stay tuned!
        </h1>

        {loading ? (
          <p className="text-muted-foreground">Loading schools…</p>
        ) : orgs.length === 0 ? (
          <p className="text-muted-foreground">We will be live soon! Stay tuned!</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orgs.map((org) => (
              <Link
                key={org.id}
                href={`/schools/${encodeURIComponent(org.slug)}`}
                className="rounded-xl border border-accent bg-muted p-6 text-left transition hover:border-primary hover:bg-muted/80"
              >
                <h2 className="font-bold text-foreground">{org.name}</h2>
                <p className="mt-1 text-xs text-muted-foreground">View map →</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
