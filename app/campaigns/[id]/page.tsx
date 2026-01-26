"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useDashboard } from "@/components/dashboard-context";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { Campaign, CampaignQuestion } from "@/types";
import { CAMPAIGN_REQUIRED_FIELDS } from "@/types";

const MAX_QUESTIONS = 10;

type ResponseRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  student_id: string | null;
  venmo_username: string | null;
  created_at: string;
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { orgId } = useDashboard();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [responses, setResponses] = useState<ResponseRow[]>([]);

  const [name, setName] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
    (async () => {
      let query = supabase.from("campaigns").select("*").eq("id", id);
      if (orgId != null) {
        query = query.eq("organization_id", orgId);
      }
      const { data, error } = await query.single();
      if (error || !data) {
        setNotFound(true);
        setCampaign(null);
        setLoading(false);
        return;
      }
      const c = data as Campaign;
      setCampaign(c);
      setName(c.name ?? "");
      const qs = Array.isArray(c.questions) ? c.questions : [];
      const sorted = [...qs].sort(
        (a, b) => (typeof a === "object" && a?.order ? a.order : 0) - (typeof b === "object" && b?.order ? b.order : 0)
      );
      setQuestions(
        sorted.length > 0
          ? sorted.map((q) => (typeof q === "string" ? q : (q as { text: string }).text))
          : [""]
      );
      setLoading(false);
    })();
  }, [id, orgId]);

  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
    (async () => {
      let query = supabase
        .from("responses")
        .select("*")
        .eq("campaign_id", id)
        .order("created_at", { ascending: false });
      if (orgId != null) {
        query = query.eq("organization_id", orgId);
      }
      const { data } = await query;
      setResponses((data as ResponseRow[]) ?? []);
    })();
  }, [id, orgId]);

  // Realtime: new claims for this campaign show up without refresh
  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`campaign-responses-${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "responses",
          filter: `campaign_id=eq.${id}`,
        },
        (payload: { new: ResponseRow }) => {
          const row = payload.new;
          if (orgId != null && (row as { organization_id?: string | null }).organization_id !== orgId) return;
          setResponses((prev) => [row as ResponseRow, ...prev]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, orgId]);

  const addQuestion = () => {
    if (questions.length >= MAX_QUESTIONS) return;
    setQuestions((q) => [...q, ""]);
  };
  const removeQuestion = (i: number) => {
    setQuestions((q) => q.filter((_, idx) => idx !== i));
  };
  const setQuestion = (i: number, text: string) => {
    setQuestions((q) => {
      const next = [...q];
      next[i] = text;
      return next;
    });
  };

  async function handleSave() {
    if (!id || !name.trim()) return;
    const supabase = createClient();
    const qs: CampaignQuestion[] = questions
      .map((text, order) => ({ order: order + 1, text: text.trim() }))
      .filter((q) => q.text.length > 0);
    setSaving(true);
    const { error } = await supabase
      .from("campaigns")
      .update({ name: name.trim(), questions: qs.length ? qs : null })
      .eq("id", id);
    setSaving(false);
    if (!error) {
      setCampaign((prev) =>
        prev ? { ...prev, name: name.trim(), questions: qs } : null
      );
    }
  }

  async function handleDelete() {
    if (!id) return;
    const supabase = createClient();
    setDeleting(true);
    const { error } = await supabase
      .from("campaigns")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    setDeleting(false);
    if (!error) {
      router.push("/");
    } else {
      console.error("Archive failed:", error);
      alert("Could not archive campaign.");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading campaign...
      </div>
    );
  }
  if (notFound || !campaign) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-muted-foreground">Campaign not found.</p>
        <Link href="/" className="text-primary hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const requiredCount = CAMPAIGN_REQUIRED_FIELDS.length;
  const displayRequired =
    Array.isArray(campaign.required_fields) && campaign.required_fields.length > 0
      ? campaign.required_fields
      : CAMPAIGN_REQUIRED_FIELDS;

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="rounded-xl border border-accent bg-muted p-6">
          <h1 className="mb-6 text-2xl font-bold">Edit Campaign</h1>
          <p className="mb-6 font-mono text-xs text-muted-foreground">{campaign.id}</p>

          {/* Required fields (read-only) */}
          <div className="mb-6 rounded-lg border border-success/30 bg-background/95 p-3">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-success">
              Required fields (reward payout)
            </h2>
            <ul className="space-y-1.5 text-sm text-accent">
              {displayRequired.map((f) => (
                <li key={f.key} className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  {f.label}
                </li>
              ))}
            </ul>
          </div>

          <label className="mb-1 block text-sm text-muted-foreground">Campaign name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mb-6 w-full rounded border border-accent bg-background px-3 py-2 text-sm"
          />

          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm text-muted-foreground">
              Additional questions (up to {MAX_QUESTIONS})
            </label>
            {questions.length < MAX_QUESTIONS && (
              <button
                type="button"
                onClick={addQuestion}
                className="text-xs text-primary hover:underline"
              >
                + Add question
              </button>
            )}
          </div>
          <div className="mb-6 space-y-2">
            {questions.map((q, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQuestion(i, e.target.value)}
                  placeholder={`Question ${i + 1}`}
                  className="flex-1 rounded border border-accent bg-background px-3 py-2 text-sm"
                />
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQuestion(i)}
                    className="text-destructive hover:underline"
                    aria-label="Remove question"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-accent pt-6">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="rounded bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded bg-destructive px-4 py-2 font-bold text-destructive-foreground disabled:opacity-50"
                >
                  {deleting ? "Archiving..." : "Yes, archive"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded border border-accent px-4 py-2 text-sm text-muted-foreground"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 rounded border border-destructive/50 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                Archive campaign
              </button>
            )}
          </div>
        </div>

        <div className="mt-12 border-t border-accent pt-8">
          <h2 className="mb-4 text-xl font-bold uppercase tracking-widest text-primary">
            Live Response Ledger
          </h2>
          <div className="overflow-hidden rounded-xl border border-accent bg-muted">
            <table className="w-full text-left text-xs">
              <thead className="bg-background/50 font-black uppercase text-muted-foreground">
                <tr>
                  <th className="p-4">Student</th>
                  <th className="p-4">Student ID</th>
                  <th className="p-4">Venmo</th>
                  <th className="p-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-accent">
                {responses.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-4 text-muted-foreground">
                      No responses yet.
                    </td>
                  </tr>
                )}
                {responses.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/responses/${r.id}`)}
                    className="cursor-pointer transition-colors hover:bg-background/30"
                  >
                    <td className="p-4">
                      <Link
                        href={`/responses/${r.id}`}
                        className="block font-bold hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.first_name ?? ""} {r.last_name ?? ""}
                      </Link>
                    </td>
                    <td className="p-4 text-muted-foreground">{r.student_id ?? "—"}</td>
                    <td className="p-4 text-success">
                      {r.venmo_username
                        ? `@${(r.venmo_username ?? "").replace(/^@/, "")}`
                        : "—"}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {r.created_at
                        ? new Date(r.created_at).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
