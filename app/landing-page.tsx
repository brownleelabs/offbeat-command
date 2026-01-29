"use client";

import { useState } from "react";
import Link from "next/link";
import { submitAccessRequest } from "@/app/actions";

export default function LandingPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [institution, setInstitution] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("loading");
    const result = await submitAccessRequest({
      name: name.trim(),
      email: email.trim(),
      institution: institution.trim() || undefined,
      message: message.trim() || undefined,
    });
    if (result.success) {
      setStatus("success");
      setName("");
      setEmail("");
      setInstitution("");
      setMessage("");
    } else {
      setStatus("error");
      setError(result.error ?? "Something went wrong.");
    }
  }

  return (
    <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-4 sm:px-8">
        <div className="mx-auto grid w-full max-w-4xl grid-cols-1 items-center gap-8 lg:grid-cols-[1fr,380px] lg:gap-12">
          {/* Hero: typography-led, bigger subtext */}
          <section aria-label="Introduction" className="flex flex-col justify-center">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground sm:text-[32px]">
              Campus Mobility Project
            </h1>
            <p className="mt-3 max-w-md whitespace-normal text-[18px] leading-snug text-muted-foreground sm:whitespace-nowrap sm:text-[20px]">
              Leveraging DePIN infrastructure to drive student welfare.
            </p>
            <p className="mt-5 text-[16px] text-muted-foreground">
              Already have access?{" "}
              <Link
                href="/login"
                className="font-medium text-primary underline decoration-primary underline-offset-2 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Sign in
              </Link>
            </p>
          </section>

          {/* Card: compact form so everything fits in viewport */}
          <section aria-label="Request access form" className="flex flex-col justify-center">
            <div className="rounded-2xl border border-white/[0.06] bg-muted/80 p-6 shadow-xl backdrop-blur-sm">
              <h2 className="text-[17px] font-semibold tracking-tight text-foreground">
                Request access
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                We&apos;ll review and get back to you.
              </p>

              {status === "success" ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-4 rounded-xl border border-success/20 bg-success/5 px-4 py-3 text-[14px] text-success"
                >
                  Thanks, we&apos;ll be in touch.
                </p>
              ) : (
                <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
                  <div>
                    <label
                      htmlFor="access-name"
                      className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Name
                    </label>
                    <input
                      id="access-name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full rounded-lg border border-white/10 bg-background/80 px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="access-email"
                      className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Email
                    </label>
                    <input
                      id="access-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full rounded-lg border border-white/10 bg-background/80 px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      placeholder="you@campus.edu"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="access-institution"
                      className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Institution
                    </label>
                    <input
                      id="access-institution"
                      type="text"
                      autoComplete="organization"
                      value={institution}
                      onChange={(e) => setInstitution(e.target.value)}
                      required
                      className="w-full rounded-lg border border-white/10 bg-background/80 px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      placeholder="Your institution or organization"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="access-message"
                      className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Message <span className="normal-case text-muted-foreground/70">(optional)</span>
                    </label>
                    <textarea
                      id="access-message"
                      rows={3}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full resize-none rounded-lg border border-white/10 bg-background/80 px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      placeholder="Why you need access"
                    />
                  </div>
                  {error && (
                    <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">
                      {error}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    aria-busy={status === "loading"}
                    className="w-full rounded-lg bg-primary py-3 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {status === "loading" ? "Submitting…" : "Request access"}
                  </button>
                </form>
              )}

              <p className="mt-4 border-t border-white/[0.06] pt-4 text-center">
                <Link
                  href="/schools"
                  className="text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  I&apos;m a Student / Hunter
                </Link>
              </p>
            </div>
          </section>
        </div>
      </main>

      <footer className="shrink-0 px-6 py-3 text-center text-[11px] tracking-wide text-muted-foreground/80 sm:px-8">
        © Offbeat Options, LLC 2025
      </footer>
    </div>
  );
}
