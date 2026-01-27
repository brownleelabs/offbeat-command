"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import MapView from "@/components/map-view";

type OrgRow = { id: string; name: string; slug: string };

export default function SchoolMapPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : params.slug?.[0] ?? "";
  const [org, setOrg] = useState<OrgRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setNotFound(false);
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug")
        .eq("slug", slug)
        .single();
      if (error || !data) {
        setNotFound(true);
        setOrg(null);
      } else {
        setOrg(data as OrgRow);
      }
    })().finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (notFound || !org) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-muted-foreground">School not found.</p>
        <Link href="/schools" className="text-primary hover:underline">
          ← Back to schools
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-accent bg-muted px-4 py-3">
        <Link
          href="/schools"
          className="text-sm text-muted-foreground transition hover:text-foreground"
        >
          ← Select another school
        </Link>
        <h1 className="text-lg font-bold text-primary">{org.name}</h1>
        <span className="w-28 text-right text-xs text-muted-foreground">
          Treasure map
        </span>
      </header>
      <main className="min-h-0 flex-1">
        <div className="h-full">
          <MapView readOnly orgId={org.id} />
        </div>
      </main>
    </div>
  );
}
