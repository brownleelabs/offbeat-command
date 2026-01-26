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

export default function ClaimPage() {
  const params = useParams();
  const [status, setStatus] = useState<PageStatus>("loading");
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
    setErrorMsg("");

    const supabase = createClient();

    try {
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

      const { error: updateError } = await supabase
        .from("tokens")
        .update({ status: "found" })
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-black p-4 text-white">
      {status === "loading" && (
        <h1 className="text-2xl animate-pulse">Loading...</h1>
      )}

      {(status === "form" || status === "submitting") && (
        <div className="w-full max-w-md">
          <h1 className="mb-6 text-2xl font-bold text-green-500">
            Claim your reward
          </h1>
          <p className="mb-6 text-sm text-zinc-400">
            Enter your details for payout. All fields are required.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">
                {CAMPAIGN_REQUIRED_FIELDS.find((f) => f.key === "first_name")?.label}
              </label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded border border-gray-700 bg-zinc-900 px-3 py-2 text-sm"
                placeholder="First name"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">
                {CAMPAIGN_REQUIRED_FIELDS.find((f) => f.key === "last_name")?.label}
              </label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded border border-gray-700 bg-zinc-900 px-3 py-2 text-sm"
                placeholder="Last name"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">
                Student ID
              </label>
              <input
                type="text"
                required
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full rounded border border-gray-700 bg-zinc-900 px-3 py-2 text-sm"
                placeholder="Student ID"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">
                Student email
              </label>
              <input
                type="email"
                required
                value={studentEmail}
                onChange={(e) => setStudentEmail(e.target.value)}
                className="w-full rounded border border-gray-700 bg-zinc-900 px-3 py-2 text-sm"
                placeholder="you@university.edu"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">
                Venmo username
              </label>
              <input
                type="text"
                required
                value={venmoUsername}
                onChange={(e) => setVenmoUsername(e.target.value)}
                className="w-full rounded border border-gray-700 bg-zinc-900 px-3 py-2 text-sm"
                placeholder="@username"
              />
            </div>

            {questions.length > 0 && (
              <div className="border-t border-gray-800 pt-4">
                <h2 className="mb-3 text-sm font-bold text-zinc-400">
                  Survey questions
                </h2>
                <div className="space-y-3">
                  {questions
                    .sort((a, b) => a.order - b.order)
                    .map((q) => (
                      <div key={q.order}>
                        <label className="mb-1 block text-xs text-zinc-500">
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
                          className="w-full rounded border border-gray-700 bg-zinc-900 px-3 py-2 text-sm"
                        />
                      </div>
                    ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="mt-6 w-full rounded bg-green-600 py-3 font-bold text-black disabled:opacity-50"
            >
              {status === "submitting" ? "Submitting..." : "Submit & claim $25.00"}
            </button>
          </form>
        </div>
      )}

      {status === "success" && (
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold text-green-500">ACCESS GRANTED</h1>
          <p className="text-xl">Asset Secured: $25.00</p>
          <p className="mt-2 text-sm text-zinc-500">
            Payout will be sent to your Venmo.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="text-center">
          <h1 className="mb-4 text-3xl font-bold text-red-500">Something went wrong</h1>
          <div className="rounded border border-red-500/50 bg-red-900/30 p-4">
            <p className="break-all font-mono text-sm text-red-400">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
