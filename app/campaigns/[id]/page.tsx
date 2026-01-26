"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { Campaign, CampaignQuestion } from "@/types";
import { CAMPAIGN_REQUIRED_FIELDS } from "@/types";

const MAX_QUESTIONS = 10;

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [name, setName] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", id)
        .single();
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
  }, [id]);

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
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    setDeleting(false);
    if (!error) {
      router.push("/");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-500">
        Loading campaign...
      </div>
    );
  }
  if (notFound || !campaign) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <p className="text-zinc-400">Campaign not found.</p>
        <Link href="/" className="text-blue-400 hover:underline">
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
    <div className="min-h-screen bg-black p-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h1 className="mb-6 text-2xl font-bold">Edit Campaign</h1>
          <p className="mb-6 font-mono text-xs text-zinc-500">{campaign.id}</p>

          {/* Required fields (read-only) */}
          <div className="mb-6 rounded-lg border border-emerald-500/30 bg-black/40 p-3">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
              Required fields (reward payout)
            </h2>
            <ul className="space-y-1.5 text-sm text-zinc-300">
              {displayRequired.map((f) => (
                <li key={f.key} className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span>
                  {f.label}
                </li>
              ))}
            </ul>
          </div>

          <label className="mb-1 block text-sm text-gray-400">Campaign name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mb-6 w-full rounded border border-gray-700 bg-black px-3 py-2 text-sm"
          />

          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm text-gray-400">
              Additional questions (up to {MAX_QUESTIONS})
            </label>
            {questions.length < MAX_QUESTIONS && (
              <button
                type="button"
                onClick={addQuestion}
                className="text-xs text-blue-400 hover:underline"
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
                  className="flex-1 rounded border border-gray-700 bg-black px-3 py-2 text-sm"
                />
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQuestion(i)}
                    className="text-red-400 hover:underline"
                    aria-label="Remove question"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-gray-800 pt-6">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="rounded bg-blue-600 px-4 py-2 font-bold disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded bg-red-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded border border-gray-600 px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 rounded border border-red-500/50 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" />
                Delete campaign
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
