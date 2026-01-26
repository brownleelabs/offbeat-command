"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { getTokenForClaim, submitClaim } from "@/app/actions";
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

    (async () => {
      const result = await getTokenForClaim(rawId);
      if (!result) {
        setStatus("error");
        setErrorMsg("Token not found. Check the link and try again.");
        return;
      }
      const id = (result.token as { id: string }).id;
      setTokenId(id);
      if (result.campaign) setCampaign(result.campaign as Campaign);
      setStatus("form");
    })();
  }, [params.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenId) return;

    setStatus("submitting");
    setSubmitPhase("location");
    setErrorMsg("");

    try {
      const coords = await getCurrentPositionAsync();
      setSubmitPhase("saving");

      const questions = Array.isArray(campaign?.questions) ? campaign.questions : [];
      const customAnswersArray = questions.map((q: CampaignQuestion) => ({
        order: q.order,
        text: q.text,
        answer: customAnswers[q.order]?.trim() ?? "",
      }));

      await submitClaim({
        tokenId,
        campaignId: campaign?.id ?? null,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        studentId: studentId.trim(),
        studentEmail: studentEmail.trim(),
        venmoUsername: venmoUsername.trim(),
        customAnswers: customAnswersArray,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });

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
