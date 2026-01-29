"use client";

import { useState, useMemo } from "react";
import { submitClaim } from "@/app/actions";
import {
  CAMPAIGN_REQUIRED_FIELDS,
  type Campaign,
  type CampaignQuestion,
} from "@/types";

type SubmitPhase = "location" | "saving";

/** Collect any data available from the tap context (browser/device) without extra permissions. */
function getClaimMetadata(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const m: Record<string, unknown> = {
    user_agent: navigator.userAgent,
    language: navigator.language,
    languages: Array.isArray(navigator.languages) ? navigator.languages : [],
    platform: navigator.platform ?? undefined,
    screen_width: window.screen?.width,
    screen_height: window.screen?.height,
    device_pixel_ratio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezone_offset_min: new Date().getTimezoneOffset(),
    hardware_concurrency: (navigator as { hardwareConcurrency?: number }).hardwareConcurrency,
    cookie_enabled: navigator.cookieEnabled,
  };
  const nav = navigator as { deviceMemory?: number; connection?: { effectiveType?: string } };
  if (typeof nav.deviceMemory === "number") m.device_memory_gb = nav.deviceMemory;
  if (nav.connection?.effectiveType) m.connection_effective_type = nav.connection.effectiveType;
  return m;
}

function getCurrentPositionAsync(
  options?: PositionOptions
): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 15000, maximumAge: 60000, ...options }
    );
  });
}

interface ClaimFormProps {
  tokenId: string;
  campaign: Campaign | null;
}

export default function ClaimForm({ tokenId, campaign }: ClaimFormProps) {
  const [status, setStatus] = useState<"form" | "submitting" | "success" | "error">("form");
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("saving");
  const [errorMsg, setErrorMsg] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [venmoUsername, setVenmoUsername] = useState("");
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});

  const tapOpenedAt = useMemo(() => new Date().toISOString(), []);

  async function handleSubmit(e: React.FormEvent) {
    // LOG: Rocket log at the ABSOLUTE BEGINNING - first statement to verify click is registered
    console.log('[ClaimForm] 🚀 Calling submitClaim server action:', {
      tokenId: tokenId.slice(0, 8) + '...',
      campaignId: campaign?.id ? campaign.id.slice(0, 8) + '...' : 'null',
      studentEmail,
      timestamp: new Date().toISOString(),
    });

    e.preventDefault();
    
    // Guard: Prevent double submission
    if (status === "submitting" || status === "success") {
      console.warn('[ClaimForm] ⚠️ Form submission blocked - already submitting or completed');
      return;
    }

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

      const claimMetadata: Record<string, unknown> = {
        ...getClaimMetadata(),
        timestamp_open: tapOpenedAt,
        timestamp_submit: new Date().toISOString(),
      };

      const result = await submitClaim({
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
        claimMetadata,
      })

      console.log('[ClaimForm] 📥 Server action response:', {
        success: result.success,
        error: result.success ? undefined : result.error,
        timestamp: new Date().toISOString(),
      })

      if (result.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(result.error || "Submission failed.");
      }
    } catch (err: unknown) {
      console.error('[ClaimForm] ❌ Exception calling submitClaim:', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        timestamp: new Date().toISOString(),
      })
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Submission failed.");
    }
  }

  const questions = Array.isArray(campaign?.questions) ? campaign.questions : [];

  if (status === "success") {
    return (
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold text-success">ACCESS GRANTED</h1>
        <p className="text-xl text-success">Asset Secured: $25.00</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Payout will be sent to your Venmo.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="text-center">
        <h1 className="mb-4 text-3xl font-bold text-destructive">Something went wrong</h1>
        <div className="rounded border border-destructive/50 bg-destructive/10 p-4">
          <p className="break-all font-mono text-sm text-destructive">{errorMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="mb-6 text-2xl font-bold text-primary">Claim your reward</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Enter your details for payout. All fields are required.
      </p>

      <form id="claim-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="claim-first-name" className="mb-1 block text-xs text-muted-foreground">
            {CAMPAIGN_REQUIRED_FIELDS.find((f) => f.key === "first_name")?.label}
          </label>
          <input
            id="claim-first-name"
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
            placeholder="First name"
          />
        </div>
        <div>
          <label htmlFor="claim-last-name" className="mb-1 block text-xs text-muted-foreground">
            {CAMPAIGN_REQUIRED_FIELDS.find((f) => f.key === "last_name")?.label}
          </label>
          <input
            id="claim-last-name"
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
            placeholder="Last name"
          />
        </div>
        <div>
          <label htmlFor="claim-student-id" className="mb-1 block text-xs text-muted-foreground">Student ID</label>
          <input
            id="claim-student-id"
            type="text"
            required
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
            placeholder="Student ID"
          />
        </div>
        <div>
          <label htmlFor="claim-student-email" className="mb-1 block text-xs text-muted-foreground">Student email</label>
          <input
            id="claim-student-email"
            type="email"
            required
            value={studentEmail}
            onChange={(e) => setStudentEmail(e.target.value)}
            className="w-full rounded border border-accent bg-muted px-3 py-2 text-sm"
            placeholder="you@university.edu"
          />
        </div>
        <div>
          <label htmlFor="claim-venmo-username" className="mb-1 block text-xs text-muted-foreground">Venmo username</label>
          <input
            id="claim-venmo-username"
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
            <h2 className="mb-3 text-sm font-bold text-muted-foreground">Survey questions</h2>
            <div className="space-y-3">
              {[...questions]
                .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
                .map((q) => {
                  const inputId = `claim-question-${q.order}`;
                  return (
                    <div key={q.order}>
                      <label htmlFor={inputId} className="mb-1 block text-xs text-muted-foreground">
                        {q.text}
                      </label>
                      <input
                        id={inputId}
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
                  );
                })}
            </div>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Location Access Required for Reward
        </p>
        <button
          id="claim-submit-button"
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
  );
}
