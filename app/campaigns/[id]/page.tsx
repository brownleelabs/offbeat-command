"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useDashboard } from "@/components/dashboard-context";
import { ArrowLeft, Trash2, Play } from "lucide-react";
import {
  getCampaign,
  getCampaignAuditLog,
  insertCampaign,
  updateCampaign,
  archiveCampaigns,
  softDeleteCampaigns,
  markCampaignViewed,
} from "@/app/campaigns/campaign-actions";
import type { Campaign, CampaignQuestion } from "@/types";
import { CAMPAIGN_REQUIRED_FIELDS } from "@/types";

const MAX_QUESTIONS = 10;
/** UI shows this many most recent responses; full count/export supports up to 10k per campaign. */
const RESPONSE_LEDGER_DISPLAY_LIMIT = 200;

type ResponseRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  student_id: string | null;
  venmo_username: string | null;
  created_at: string;
};

function applyCampaignToForm(c: Campaign, setName: (s: string) => void, setQuestions: (q: string[]) => void) {
  setName(String(c.name ?? "").trim());
  const qs = Array.isArray(c.questions) ? c.questions : [];
  const orderNum = (q: unknown): number => {
    if (q == null || typeof q !== "object" || !("order" in q)) return 0;
    const o = Number((q as { order?: unknown }).order);
    return Number.isFinite(o) ? o : 0;
  };
  const sorted = [...qs].sort((a, b) => orderNum(a) - orderNum(b));
  setQuestions(
    sorted.length > 0
      ? sorted.map((q) => {
          if (typeof q === "string") return q;
          if (q != null && typeof q === "object" && "text" in q && typeof (q as { text: string }).text === "string")
            return (q as { text: string }).text;
          return "";
        })
      : [""]
  );
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { orgId, userRole } = useDashboard();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [responseTotal, setResponseTotal] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [auditEvents, setAuditEvents] = useState<Array<{ event_type: string; at: string; actor_user_id: string | null }>>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [assignedTokenCount, setAssignedTokenCount] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string>("");

  const isSuperAdmin = userRole === "SUPER_ADMIN";

  const isUuidLike = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  useEffect(() => {
    if (!id || !isUuidLike(id)) {
      setNotFound(true);
      setCampaign(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getCampaign(id);
        if (cancelled) return;
        if (!res.success || !res.campaign) {
          setNotFound(true);
          setCampaign(null);
          return;
        }
        const c = res.campaign as Campaign;
        setCampaign(c);
        setOrgName(null);
        applyCampaignToForm(c, setName, setQuestions);
        if (isSuperAdmin) markCampaignViewed(id).catch(() => {});
        if (
          typeof c.organization_id === "string" &&
          c.organization_id.trim().length > 0 &&
          isUuidLike(c.organization_id.trim())
        ) {
          try {
            const supabase = createClient();
            const { data, error } = await supabase
              .from("organizations")
              .select("name")
              .eq("id", c.organization_id.trim())
              .single();
            if (cancelled) return;
            const name = (data as { name?: unknown } | null)?.name;
            setOrgName(error ? null : name != null ? String(name) : null);
          } catch {
            if (!cancelled) setOrgName(null);
          }
        }
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setCampaign(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isSuperAdmin]);

  useEffect(() => {
    if (!id || !isUuidLike(id)) {
      setResponses([]);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      try {
        let query = supabase
          .from("responses")
          .select("*")
          .eq("campaign_id", id)
          .order("created_at", { ascending: false })
          .limit(RESPONSE_LEDGER_DISPLAY_LIMIT);
        const orgIdFilter =
          orgId != null &&
          typeof orgId === "string" &&
          orgId.trim().length > 0 &&
          isUuidLike(orgId.trim())
            ? orgId.trim()
            : null;
        if (orgIdFilter) {
          query = query.eq("organization_id", orgIdFilter);
        }
        const { data, error } = await query;
        if (cancelled) return;
        if (error) setResponses([]);
        else setResponses(Array.isArray(data) ? (data as ResponseRow[]) : []);
      } catch {
        if (!cancelled) setResponses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, orgId]);

  // Response totals (exact count; not capped at 200)
  useEffect(() => {
    if (!id || !isUuidLike(id)) {
      setResponseTotal(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      try {
        let query = supabase
          .from("responses")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", id);
        const orgIdFilter =
          orgId != null &&
          typeof orgId === "string" &&
          orgId.trim().length > 0 &&
          isUuidLike(orgId.trim())
            ? orgId.trim()
            : null;
        if (orgIdFilter) {
          query = query.eq("organization_id", orgIdFilter);
        }
        const { count, error } = await query;
        if (cancelled) return;
        if (error) {
          setResponseTotal(null);
          return;
        }
        const safeCount =
          typeof count === "number" && Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
        setResponseTotal(safeCount);
      } catch {
        if (!cancelled) setResponseTotal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, orgId]);

  // Realtime: new claims for this campaign show up without refresh (only when id is UUID-like)
  useEffect(() => {
    if (!id || !isUuidLike(id)) return;
    const orgIdFilter =
      orgId != null &&
      typeof orgId === "string" &&
      orgId.trim().length > 0 &&
      isUuidLike(orgId.trim())
        ? orgId.trim()
        : null;
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
          const row = payload?.new;
          if (row == null || typeof row !== "object") return;
          const rowId = (row as { id?: unknown }).id;
          if (typeof rowId !== "string" || rowId.length === 0) return;
          if (orgIdFilter != null && (row as { organization_id?: string | null }).organization_id !== orgIdFilter) return;
          setResponses((prev) =>
            (Array.isArray(prev) ? [row as ResponseRow, ...prev] : [row as ResponseRow]).slice(0, RESPONSE_LEDGER_DISPLAY_LIMIT)
          );
          setResponseTotal((prev) => (typeof prev === "number" ? prev + 1 : prev));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, orgId]);

  useEffect(() => {
    if (!auditOpen || !id || !isUuidLike(id) || !isSuperAdmin) return;
    let cancelled = false;
    setAuditLoading(true);
    getCampaignAuditLog(id, 10).then((res) => {
      if (cancelled) return;
      setAuditLoading(false);
      if (res.success) setAuditEvents(res.events);
      else setAuditEvents([]);
    });
    return () => {
      cancelled = true;
    };
  }, [auditOpen, id, isSuperAdmin]);

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
    const nameStr = String(name ?? "").trim();
    if (!id || !nameStr) return;
    setSaveError("");
    const qs: CampaignQuestion[] = questions
      .map((text, order) => ({ order: order + 1, text: String(text ?? "").trim() }))
      .filter((q) => q.text.length > 0);
    setSaving(true);
    try {
      const res = await updateCampaign(id, { name: nameStr, questions: qs.length ? qs : null });
      if (res.success) {
        setCampaign((prev) => (prev ? { ...prev, name: nameStr, questions: qs } : null));
      } else {
        setSaveError(res.error ?? "Save failed.");
      }
    } catch {
      setSaveError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLaunch() {
    if (!id || campaign?.status !== "draft") return;
    setLaunching(true);
    setSaveError("");
    try {
      const res = await updateCampaign(id, { status: "active" });
      if (res.success) {
        const now = new Date().toISOString();
        setCampaign((prev) => (prev ? { ...prev, status: "active", launched_at: now } : null));
      } else {
        setSaveError(res.error ?? "Launch failed.");
      }
    } catch {
      setSaveError("Launch failed.");
    } finally {
      setLaunching(false);
    }
  }

  async function handleDeactivate() {
    if (!id || campaign?.status !== "active") return;
    setDeactivating(true);
    setSaveError("");
    try {
      const res = await updateCampaign(id, { status: "inactive" });
      if (res.success) {
        setCampaign((prev) => (prev ? { ...prev, status: "inactive" } : null));
      } else {
        setSaveError(res.error ?? "Deactivate failed.");
      }
    } catch {
      setSaveError("Deactivate failed.");
    } finally {
      setDeactivating(false);
    }
  }

  async function handleDuplicate() {
    if (!campaign) return;
    setDuplicating(true);
    setSaveError("");
    try {
      const res = await insertCampaign({
        name: "Copy of " + (campaign.name ?? "Untitled"),
        organization_id: campaign.organization_id ?? "",
        required_fields:
          Array.isArray(campaign.required_fields) && campaign.required_fields.length > 0
            ? campaign.required_fields
            : CAMPAIGN_REQUIRED_FIELDS,
        questions:
          Array.isArray(campaign.questions) && campaign.questions.length > 0
            ? campaign.questions
            : null,
      });
      if (res.success) {
        router.push("/campaigns/" + res.id);
      } else {
        setSaveError(res.error ?? "Duplicate failed.");
      }
    } catch {
      setSaveError("Duplicate failed.");
    } finally {
      setDuplicating(false);
    }
  }

  async function handleArchive() {
    if (!id) return;
    setDeleting(true);
    setSaveError("");
    try {
      const res = await archiveCampaigns([id], true);
      if (res.success) {
        router.push("/?tab=campaigns");
      } else {
        setSaveError(res.error ?? "Archive failed.");
      }
    } catch {
      setSaveError("Archive failed.");
    } finally {
      setDeleting(false);
    }
  }

  async function _handleDelete() {
    if (!id) return;
    setDeleting(true);
    setSaveError("");
    try {
      const res = await softDeleteCampaigns([id], true);
      if (res.success) {
        router.push("/?tab=campaigns");
      } else {
        setSaveError(res.error ?? "Delete failed.");
      }
    } catch {
      setSaveError("Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  async function confirmArchiveClick() {
    if (!id) return;
    setSaveError("");
    try {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("tokens")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", id);
      if (error) {
        setSaveError("Could not load token count. Try again before archiving.");
        return;
      }
      const safeCount =
        typeof count === "number" && Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
      setAssignedTokenCount(safeCount);
      setConfirmDelete(true);
    } catch {
      setSaveError("Could not load token count. Try again before archiving.");
    }
  }

  async function doArchiveConfirm() {
    await handleArchive();
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
        <Link href="/?tab=campaigns" className="text-primary hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const _requiredCount = CAMPAIGN_REQUIRED_FIELDS.length;
  const fromCampaign = Array.isArray(campaign.required_fields)
    ? campaign.required_fields.filter((f) => f != null && typeof f === "object")
    : [];
  const displayRequired = fromCampaign.length > 0 ? fromCampaign : CAMPAIGN_REQUIRED_FIELDS;

  // Deleted/archived takes precedence: do not show "active" when campaign is deleted or archived
  const status =
    campaign.deleted_at || campaign.archived_at
      ? "inactive"
      : campaign.status === "draft" || campaign.status === "active" || campaign.status === "inactive"
        ? campaign.status
        : "draft";
  const launchedAt = campaign.launched_at ? new Date(campaign.launched_at) : null;
  const launchedAtMs = launchedAt?.getTime();
  const durationActiveDaysRaw =
    status === "active" && launchedAt != null && Number.isFinite(launchedAtMs)
      ? Math.floor((Date.now() - (launchedAtMs ?? 0)) / (24 * 60 * 60 * 1000))
      : null;
  const durationActiveDays =
    durationActiveDaysRaw != null && Number.isFinite(durationActiveDaysRaw)
      ? Math.max(0, durationActiveDaysRaw)
      : null;

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/?tab=campaigns"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="rounded-xl border border-accent bg-muted p-6">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{String(campaign.name ?? "Untitled")}</h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{campaign.id != null ? String(campaign.id) : "—"}</p>
              {orgName != null && orgName !== "" && (
                <p className="mt-1 text-sm text-muted-foreground">Organization: {String(orgName)}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    status === "active"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : status === "draft"
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-amber-500/20 text-amber-400"
                  }`}
                >
                  {status}
                </span>
                {launchedAt != null && !Number.isNaN(launchedAt.getTime()) && (
                  <span className="text-xs text-muted-foreground">
                    Launched {launchedAt.toLocaleDateString()}
                  </span>
                )}
                {durationActiveDays != null && (
                  <span className="text-xs text-muted-foreground">
                    Duration active: {durationActiveDays} day{durationActiveDays !== 1 ? "s" : ""}
                  </span>
                )}
                {campaign.created_at && !Number.isNaN(new Date(campaign.created_at).getTime()) && (
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(campaign.created_at).toLocaleDateString()}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  Responses submitted: {responseTotal != null ? responseTotal : "—"}
                </span>
                <span
                  className="text-xs text-muted-foreground"
                  title="Coming soon: live payout details via BENJI"
                >
                  Paid out: —
                </span>
              </div>
            </div>
          </div>

          {/* Required fields (read-only) */}
          <div className="mb-6 rounded-lg border border-success/30 bg-background/95 p-3">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-success">
              Required fields (reward payout)
            </h2>
            <ul className="space-y-1.5 text-sm text-accent">
              {displayRequired.map((f, i) => (
                <li key={typeof f.key === "string" ? f.key : `req-${i}`} className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  {String(f.label ?? f.key ?? "—")}
                </li>
              ))}
            </ul>
          </div>

          <label
            htmlFor="campaign-name"
            className="mb-1 block text-sm text-muted-foreground"
          >
            Campaign name
          </label>
          <input
            id="campaign-name"
            name="campaignName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={status !== "draft"}
            maxLength={500}
            className="mb-6 w-full rounded border border-accent bg-background px-3 py-2 text-sm disabled:opacity-60"
          />

          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Additional questions (up to {MAX_QUESTIONS})
              {status !== "draft" && (
                <span className="ml-2 text-xs">(editable only when draft)</span>
              )}
            </p>
            {status === "draft" && questions.length < MAX_QUESTIONS && (
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
                  id={`campaign-question-${i}`}
                  name={`campaignQuestion${i + 1}`}
                  aria-label={`Campaign question ${i + 1}`}
                  type="text"
                  value={q ?? ""}
                  onChange={(e) => setQuestion(i, e.target.value)}
                  placeholder={`Question ${i + 1}`}
                  disabled={status !== "draft"}
                  className="flex-1 rounded border border-accent bg-background px-3 py-2 text-sm disabled:opacity-60"
                />
                {status === "draft" && questions.length > 1 && (
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

          {saveError && <p className="mb-4 text-sm text-destructive">{saveError}</p>}
          <div className="flex flex-wrap items-center gap-4 border-t border-accent pt-6">
            {status === "draft" && (
              <button
                onClick={handleSave}
                disabled={saving || !String(name ?? "").trim()}
                className="rounded bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            )}
            {status === "draft" && isSuperAdmin && (
              <button
                onClick={handleLaunch}
                disabled={launching}
                className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50 hover:bg-emerald-700"
              >
                <Play className="h-4 w-4" />
                {launching ? "Launching…" : "Launch campaign"}
              </button>
            )}
            {status === "active" && isSuperAdmin && (
              <button
                onClick={handleDeactivate}
                disabled={deactivating}
                className="rounded border border-amber-500/50 px-4 py-2 text-sm font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
              >
                {deactivating ? "Deactivating…" : "Deactivate"}
              </button>
            )}
            {isSuperAdmin && !confirmDelete && (
              <button
                onClick={handleDuplicate}
                disabled={duplicating}
                className="rounded border border-accent px-4 py-2 text-sm text-muted-foreground hover:bg-background/80 disabled:opacity-50"
              >
                {duplicating ? "Duplicating…" : "Duplicate"}
              </button>
            )}
            {confirmDelete ? (
              <span className="flex flex-wrap items-center gap-2">
                {assignedTokenCount != null && assignedTokenCount > 0 && (
                  <span className="text-sm text-amber-600 dark:text-amber-400">
                    This campaign is assigned to {assignedTokenCount} token(s). Archiving will deactivate them.
                  </span>
                )}
                <button
                  onClick={doArchiveConfirm}
                  disabled={deleting}
                  className="rounded bg-destructive px-4 py-2 font-bold text-destructive-foreground disabled:opacity-50"
                >
                  {deleting ? "Archiving..." : "Yes, archive"}
                </button>
                <button
                  onClick={() => { setConfirmDelete(false); setAssignedTokenCount(null); setSaveError(""); }}
                  className="rounded border border-accent px-4 py-2 text-sm text-muted-foreground"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={confirmArchiveClick}
                className="flex items-center gap-2 rounded border border-destructive/50 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                Archive campaign
              </button>
            )}
          </div>
        </div>

        {isSuperAdmin && (
          <div className="mt-8 rounded-xl border border-accent bg-muted">
            <button
              type="button"
              onClick={() => setAuditOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Recent activity
              <span className="text-muted-foreground">{auditOpen ? "−" : "+"}</span>
            </button>
            {auditOpen && (
              <div className="border-t border-accent px-4 py-3">
                {auditLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : auditEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No activity yet.</p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {auditEvents.map((evt, i) => {
                      const atDate = evt.at ? new Date(evt.at) : null;
                      const atDisplay =
                        atDate && !Number.isNaN(atDate.getTime())
                          ? atDate.toLocaleString()
                          : "—";
                      return (
                        <li key={i} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                          <span className="font-mono text-foreground">{evt.event_type}</span>
                          <span>{atDisplay}</span>
                          {evt.actor_user_id != null && (
                            <span className="font-mono text-accent">{evt.actor_user_id.slice(0, 8)}…</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-12 border-t border-accent pt-8">
          <h2 className="mb-4 text-xl font-bold uppercase tracking-widest text-primary">
            Response Ledger
          </h2>
          {responseTotal != null && responseTotal > RESPONSE_LEDGER_DISPLAY_LIMIT && (
            <p className="mb-2 text-xs text-muted-foreground">
              Showing most recent {RESPONSE_LEDGER_DISPLAY_LIMIT} of {responseTotal} responses
            </p>
          )}
          <p className="mb-4 text-xs text-muted-foreground">
            Each row is a claim; open the link to see full submission and metadata (for payout verification).
          </p>
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
                {responses.map((r, i) => {
                  const createdDate = r.created_at ? new Date(r.created_at) : null;
                  const createdDisplay =
                    createdDate && !Number.isNaN(createdDate.getTime())
                      ? createdDate.toLocaleString()
                      : "—";
                  const responseIdSafe =
                    typeof r.id === "string" && r.id.length > 0 && isUuidLike(r.id);
                  return (
                    <tr
                      key={r.id ?? `resp-${i}`}
                      onClick={() => responseIdSafe && router.push(`/responses/${r.id}`)}
                      className="cursor-pointer transition-colors hover:bg-background/30"
                    >
                      <td className="p-4">
                        {responseIdSafe ? (
                          <Link
                            href={`/responses/${r.id}`}
                            className="block font-bold hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {String(r.first_name ?? "")} {String(r.last_name ?? "")}
                          </Link>
                        ) : (
                          <span>{String(r.first_name ?? "")} {String(r.last_name ?? "")}</span>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground">{r.student_id != null ? String(r.student_id) : "—"}</td>
                      <td className="p-4 text-success">
                        {r.venmo_username
                          ? `@${String(r.venmo_username ?? "").replace(/^@/, "")}`
                          : "—"}
                      </td>
                      <td className="p-4 text-muted-foreground">{createdDisplay}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
