"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { ArrowLeft, User, Mail, CreditCard, Hash, FileText, Smartphone } from "lucide-react";

type CustomAnswerItem = { order?: number; text?: string; answer?: string };

type ResponseRecord = {
  id: string;
  campaign_id: string | null;
  token_id: string | null;
  first_name: string | null;
  last_name: string | null;
  student_id: string | null;
  student_email: string | null;
  venmo_username: string | null;
  custom_answers?: CustomAnswerItem[] | null;
  claim_metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

export default function ResponseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const [response, setResponse] = useState<ResponseRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const isUuidLike = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  useEffect(() => {
    if (!id || !isUuidLike(id)) {
      setNotFound(true);
      setResponse(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      try {
        const { data, error } = await supabase
          .from("responses")
          .select("*")
          .eq("id", id)
          .single();
        if (cancelled) return;
        if (
          error ||
          !data ||
          typeof data !== "object" ||
          Array.isArray(data)
        ) {
          setNotFound(true);
          setResponse(null);
        } else {
          setResponse(data as ResponseRecord);
        }
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setResponse(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        Loading record...
      </div>
    );
  }
  if (notFound || !response) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-muted-foreground">Response not found.</p>
        <Link href="/" className="text-primary hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const venmoDisplay = response.venmo_username
    ? `@${String(response.venmo_username ?? "").replace(/^@/, "")}`
    : "—";
  const customAnswers = Array.isArray(response.custom_answers)
    ? response.custom_answers
    : [];
  const campaignIdSafe =
    typeof response.campaign_id === "string" &&
    response.campaign_id.length > 0 &&
    isUuidLike(response.campaign_id);
  const tokenIdSafe =
    typeof response.token_id === "string" &&
    response.token_id.length > 0 &&
    isUuidLike(response.token_id);

  return (
    <div className="min-h-screen bg-background p-8 font-sans text-foreground">
      <button
        onClick={() => router.back()}
        className="mb-8 flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={18} /> Back to Ledger
      </button>

      <div className="mx-auto max-w-2xl">
        <h1 className="mb-8 text-3xl font-black uppercase tracking-tighter text-primary">
          Submission Record
        </h1>

        {(typeof response.campaign_id === "string" && response.campaign_id.length > 0) ||
        (typeof response.token_id === "string" && response.token_id.length > 0) ? (
          <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {typeof response.campaign_id === "string" && response.campaign_id.length > 0 && (
              <span>
                Campaign:{" "}
                {campaignIdSafe ? (
                  <Link
                    href={`/campaigns/${response.campaign_id}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {response.campaign_id.slice(0, 8)}…
                  </Link>
                ) : (
                  <span className="font-mono">
                    {response.campaign_id.length > 8 ? `${response.campaign_id.slice(0, 8)}…` : response.campaign_id}
                  </span>
                )}
              </span>
            )}
            {typeof response.token_id === "string" && response.token_id.length > 0 && (
              <span>
                Token:{" "}
                {tokenIdSafe ? (
                  <Link
                    href={`/fleet/${response.token_id}`}
                    className="font-mono text-primary hover:underline"
                    title="Asset details for this token"
                  >
                    {response.token_id.slice(0, 8)}…
                  </Link>
                ) : (
                  <span className="font-mono">
                    {response.token_id.length > 8 ? `${response.token_id.slice(0, 8)}…` : response.token_id}
                  </span>
                )}
              </span>
            )}
          </div>
        ) : null}

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <DetailCard
            icon={<User size={16} />}
            label="Full Name"
            value={
              `${String(response.first_name ?? "").trim()} ${String(response.last_name ?? "").trim()}`.trim() ||
              "—"
            }
          />
          <DetailCard
            icon={<Hash size={16} />}
            label="Student ID"
            value={typeof response.student_id === "string" ? response.student_id : "—"}
          />
          <DetailCard
            icon={<Mail size={16} />}
            label="Email Address"
            value={typeof response.student_email === "string" ? response.student_email : "—"}
          />
          <DetailCard
            icon={<CreditCard size={16} />}
            label="Venmo Username"
            value={venmoDisplay}
            color="text-success"
          />
        </div>

        <div className="rounded-2xl border border-accent bg-muted p-6">
          <h2 className="mb-6 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
            <FileText size={14} /> Research Variables
          </h2>
          <div className="space-y-6">
            {customAnswers.length === 0 && (
              <p className="text-sm text-muted-foreground">No custom answers.</p>
            )}
            {customAnswers.map((item, i) => (
              <div
                key={i}
                className="border-l-2 border-primary/30 pl-4"
              >
                <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
                  {item != null && typeof item === "object"
                    ? String(item.text ?? `Question ${item.order ?? i + 1}`)
                    : `Question ${i + 1}`}
                </p>
                <p className="text-sm leading-relaxed text-foreground">
                  {item != null && typeof item === "object" ? String(item.answer ?? "—") : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>

        {response.claim_metadata != null &&
          typeof response.claim_metadata === "object" &&
          !Array.isArray(response.claim_metadata) &&
          Object.keys(response.claim_metadata).length > 0 && (
          <div className="mt-8 rounded-2xl border border-accent bg-muted p-6">
            <h2 className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              <Smartphone size={14} /> Tap / claim metadata
            </h2>
            <pre className="max-h-64 overflow-auto rounded-lg border border-accent bg-background p-4 text-xs text-muted-foreground">
              {(() => {
                try {
                  return JSON.stringify(response.claim_metadata, null, 2);
                } catch {
                  return "Unable to display metadata.";
                }
              })()}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailCard({
  icon,
  label,
  value,
  color = "text-foreground",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-accent bg-muted p-4">
      <div className="mb-1 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest">
          {label}
        </span>
      </div>
      <p className={`font-mono text-sm ${color}`}>{value || "—"}</p>
    </div>
  );
}
