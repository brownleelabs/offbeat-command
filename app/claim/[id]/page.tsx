"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  CAMPAIGN_REQUIRED_FIELDS,
  type Campaign,
  type CampaignQuestion,
} from "@/types";

type PageStatus = "loading" | "form" | "submitting" | "success" | "error";
type SubmitPhase = "location" | "saving";

function getCurrentPositionAsync(
  options?: PositionOptions
): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported");
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        console.warn("Geolocation error:", err.message);
        resolve(null);
      },
      { timeout: 15000, maximumAge: 60000, ...options }
    );
  });
}

export default function ClaimPage() {
  const params = useParams();
  const [status, setStatus] = useState<PageStatus>("loading");
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("saving");
  const [errorMsg, setErrorMsg] = useState("");
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [venmoUsername, setVenmoUsername] = useState("");
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    const rawId = (params.id as string) ?? "";
    if (!rawId) return;
    const id = rawId.replace(/%20/g, "").trim();
    setTokenId(id);

    const supabase = createClient();

    (async () => {
      const { data: token, error: tokenError } = await supabase
        .from("tokens")
        .select("id, campaign_id")
        .eq("id", id)
        .single();

      if (tokenError || !token) {
        setStatus("error");
        setErrorMsg("Token not found. Check the link and try again.");
        return;
      }

      const campaignId = (token as { campaign_id: string | null }).campaign_id;
      if (campaignId) {
        const { data: camp } = await supabase
          .from("campaigns")
          .select("*")
          .eq("id", campaignId)
          .single();
        setCampaign((camp as Campaign) ?? null);
      }

      setStatus("form");
    })();
  }, [params.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenId) return;

    setStatus("submitting");
    setSubmitPhase("location");
    setErrorMsg("");

    const supabase = createClient();

    try {
      const coords = await getCurrentPositionAsync();
      setSubmitPhase("saving");

      const campaignId = campaign?.id ?? null;
      const questions = Array.isArray(campaign?.questions) ? campaign.questions : [];
      const customAnswersArray = questions.map((q: CampaignQuestion) => ({
        order: q.order,
        text: q.text,
        answer: customAnswers[q.order]?.trim() ?? "",
      }));

      const { error: insertError } = await supabase.from("responses").insert({
        token_id: tokenId,
        campaign_id: campaignId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        student_id: studentId.trim(),
        student_email: studentEmail.trim(),
        venmo_username: venmoUsername.trim(),
        custom_answers: customAnswersArray,
      });

      if (insertError) throw insertError;

      const tokenUpdate: { status: "found"; lat?: number; lng?: number } = {
        status: "found",
      };
      if (coords) {
        tokenUpdate.lat = coords.lat;
        tokenUpdate.lng = coords.lng;
      }

      const { error: updateError } = await supabase
        .from("tokens")
        .update(tokenUpdate)
        .eq("id", tokenId);

      if (updateError) throw updateError;

      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Submission failed.");
    }
  }

  const questions = Array.isArray(campaign?.questions) ? campaign.questions : [];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-foreground">
      {status === "loading" && (
        <h1 className="text-2xl animate-pulse">Loading...</h1>
      )}

      {(status === "form" || status === "submitting") && (
        <div className="w-full max-w-md">
          <h1 className="mb-6 text-2xl font-bold text-primary">
            Claim your reward
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Enter your details for payout. All fields are required.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {CAMPAIGN_REQUIRED_FIELDS.find((f) => f.key === "first_name")?.label}
              </label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
                placeholder="First name"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {CAMPAIGN_REQUIRED_FIELDS.find((f) => f.key === "last_name")?.label}
              </label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
                placeholder="Last name"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Student ID
              </label>
              <input
                type="text"
                required
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
                placeholder="Student ID"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Student email
              </label>
              <input
                type="email"
                required
                value={studentEmail}
                onChange={(e) => setStudentEmail(e.target.value)}
                className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
                placeholder="you@university.edu"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Venmo username
              </label>
              <input
                type="text"
                required
                value={venmoUsername}
                onChange={(e) => setVenmoUsername(e.target.value)}
                className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
                placeholder="@username"
              />
            </div>

            {questions.length > 0 && (
              <div className="border-t border-accent pt-4">
                <h2 className="mb-3 text-sm font-bold text-muted-foreground">
                  Survey questions
                </h2>
                <div className="space-y-3">
                  {questions
                    .sort((a, b) => a.order - b.order)
                    .map((q) => (
                      <div key={q.order}>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {q.text}
                        </label>
                        <input
                          type="text"
                          value={customAnswers[q.order] ?? ""}
                          onChange={(e) =>
                            setCustomAnswers((prev) => ({
                              ...prev,
                              [q.order]: e.target.value,
                            }))
                          }
                          className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
                        />
                      </div>
                    ))}
                </div>
              </div>
            )}

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Location Access Required for Reward
            </p>
            <button
              type="submit"
              disabled={status === "submitting"}
              className="mt-3 w-full rounded bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50"
            >
              {status === "submitting"
                ? submitPhase === "location"
                  ? "Getting your location..."
                  : "Submitting..."
                : "Submit & claim $25.00"}
            </button>
          </form>
        </div>
      )}

      {status === "success" && (
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold text-success">ACCESS GRANTED</h1>
          <p className="text-xl text-success">Asset Secured: $25.00</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Payout will be sent to your Venmo.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="text-center">
          <h1 className="mb-4 text-3xl font-bold text-destructive">Something went wrong</h1>
          <div className="rounded border border-destructive/50 bg-destructive/10 p-4">
            <p className="break-all font-mono text-sm text-destructive">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
