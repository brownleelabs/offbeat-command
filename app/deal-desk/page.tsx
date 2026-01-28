'use client'

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  HelpCircle,
  PiggyBank,
  Save,
  Users,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useDashboard } from "@/components/dashboard-context";

type DealZone = "GREEN" | "ORANGE" | "RED";

type DealScenarioRow = {
  id: string;
  name: string | null;
  university_name: string | null;
  endowment_size: number | null;
  student_enrollment: number | null;
  target_reach_percent: number | null;
  redemption_velocity: number | null;
  interest_rate: number | null;
  calculated_tdv: number | null;
  deal_zone: DealZone | null;
  created_at?: string | null;
};

const EFFICIENCY_CONSTANT = 0.567;
const ACADEMIC_MONTHS = 9;
const TOKEN_VALUE = 25;

const currency0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const currency2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const number0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percent2 = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

function safeNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function computeZone(eps: number | null, allocation: number | null): DealZone | null {
  if (eps == null || allocation == null) return null;

  // 🔴 RED: Tuition dependent OR too high allocation
  if (eps < 150_000 || allocation > 0.02) return "RED";

  // 🟢 GREEN: Rich schools
  if (eps > 500_000) return "GREEN";

  // 🟠 ORANGE: Mid-market with high allocation pressure
  if (eps >= 150_000 && eps <= 500_000 && allocation > 0.015) return "ORANGE";

  // Otherwise qualified (no cap enforced, but may have board-vote sized TDV)
  return "GREEN";
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(100, Math.round(n)));
}

/**
 * A 1–100 sales qualification score (heuristic).
 * 1 = broken / not computable or fundamentally misfit
 * 100 = ideal fit (high EPS, low allocation, fast fee recoup, no board friction)
 */
function computeDealScore(input: {
  zone: DealZone | null;
  eps: number | null;
  allocation: number | null; // decimal (0.015 = 1.5%)
  feeRecoupYears: number | null;
  tdv: number | null;
  canCompute: boolean;
}): { score: number; label: string } {
  const { zone, eps, allocation, feeRecoupYears, tdv, canCompute } = input;

  if (!canCompute || zone == null || eps == null || allocation == null || feeRecoupYears == null) {
    return { score: 1, label: "MODEL INCOMPLETE" };
  }

  // Base by zone (keeps the score aligned with the traffic light)
  let score = zone === "GREEN" ? 75 : zone === "ORANGE" ? 45 : 15;

  // EPS contribution (piecewise)
  // RED threshold: <150k ; ORANGE band: 150k–500k ; GREEN: >500k
  if (eps < 150_000) score -= 15;
  else if (eps <= 500_000) {
    // 150k..500k => +0..+18
    score += ((eps - 150_000) / (500_000 - 150_000)) * 18;
  } else if (eps <= 1_500_000) {
    // 500k..1.5M => +18..+30
    score += 18 + ((eps - 500_000) / (1_500_000 - 500_000)) * 12;
  } else {
    score += 30;
  }

  // Allocation contribution (lower allocation = easier CFO approval)
  if (allocation > 0.02) score -= 25;
  else if (allocation > 0.015) score -= 12;
  else if (allocation < 0.0025) score += 15;
  else if (allocation < 0.005) score += 8;

  // Fee recoup contribution (faster is better)
  if (feeRecoupYears > 10) score -= 18;
  else if (feeRecoupYears > 6) score -= 6;
  else if (feeRecoupYears < 3) score += 10;
  else if (feeRecoupYears < 4.5) score += 5;

  // Board vote friction (still green, but slower close)
  if (tdv != null && tdv > 5_000_000) score -= 8;

  // Zone caps (prevent a RED deal from scoring "too green")
  if (zone === "RED") score = Math.min(score, 35);
  if (zone === "ORANGE") score = Math.min(score, 75);

  const finalScore = clampScore(score);
  const label =
    finalScore >= 90
      ? "THEY SHOULD BUY NOW"
      : finalScore >= 75
        ? "STRONG FIT"
        : finalScore >= 55
          ? "WORKABLE"
          : finalScore >= 35
            ? "RISKY"
            : "BROKEN";

  return { score: finalScore, label };
}

function ZoneBadge({ zone }: { zone: DealZone | null }) {
  if (zone === "GREEN") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
        <CheckCircle2 className="h-4 w-4" />
        GREEN ZONE
      </span>
    );
  }
  if (zone === "ORANGE") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        ORANGE ZONE
      </span>
    );
  }
  if (zone === "RED") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
        <XCircle className="h-4 w-4" />
        RED ZONE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
      <AlertTriangle className="h-4 w-4" />
      ENTER INPUTS
    </span>
  );
}

export function DealDeskContent() {
  const { userRole, loading: authLoading } = useDashboard();
  const supabase = useMemo(() => createClient(), []);

  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState<string>("");
  const [universityName, setUniversityName] = useState<string>("");
  const [endowmentSize, setEndowmentSize] = useState<number>(2_000_000_000); // $2.0B baseline
  const [studentEnrollment, setStudentEnrollment] = useState<number>(30_000);
  const [targetReachPercent, setTargetReachPercent] = useState<number>(20);
  const [redemptionVelocity, setRedemptionVelocity] = useState<number>(0.8);
  const [interestRate, setInterestRate] = useState<number>(3.25);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>("");
  const [saved, setSaved] = useState(false);

  const [scenarios, setScenarios] = useState<DealScenarioRow[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState(false);
  const [loadError, setLoadError] = useState<string>("");
  const [hintOpen, setHintOpen] = useState(false);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hintOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (hintRef.current && !hintRef.current.contains(e.target as Node)) setHintOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setHintOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [hintOpen]);

  const computed = useMemo(() => {
    const E = safeNumber(endowmentSize);
    const T = safeNumber(studentEnrollment);
    const Ppct = safeNumber(targetReachPercent);
    const R = safeNumber(redemptionVelocity);
    const ipct = safeNumber(interestRate);

    const P = Ppct == null ? null : clamp(Ppct, 0, 100) / 100;
    const i = ipct == null ? null : ipct / 100;

    const activeStudents =
      T != null && P != null && T > 0 ? T * P : null;

    const annualPayout =
      activeStudents != null && R != null
        ? activeStudents * (R * ACADEMIC_MONTHS) * TOKEN_VALUE
        : null;

    const yieldFactor = i != null ? EFFICIENCY_CONSTANT * i : null;

    const tdv =
      annualPayout != null && yieldFactor != null && yieldFactor > 0
        ? annualPayout / yieldFactor
        : null;

    const eps = E != null && T != null && T > 0 ? E / T : null;
    const allocation = tdv != null && E != null && E > 0 ? tdv / E : null;

    const zone = computeZone(eps, allocation);

    // Fee Recoup Period (Years): time until risk-free yield covers 10% setup fee.
    // Formula: 1 / (9 * yield_rate_decimal)
    const feeRecoupYears =
      i != null && i > 0 ? 1 / (ACADEMIC_MONTHS * i) : null;

    // Dynamic cap recommendation:
    // - GREEN: no cap enforced
    // - ORANGE: recommend 1.5% of endowment
    // - RED: strict 1.0% of endowment
    const capPercent =
      zone === "ORANGE" ? 0.015 : zone === "RED" ? 0.01 : null;
    const capTDV = capPercent != null && E != null && E > 0 ? E * capPercent : null;
    const capAnnualPayout =
      capTDV != null && yieldFactor != null ? capTDV * yieldFactor : null;

    const perStudentAnnualCost =
      R != null ? (R * ACADEMIC_MONTHS) * TOKEN_VALUE : null;
    const capActiveStudents =
      capAnnualPayout != null && perStudentAnnualCost != null && perStudentAnnualCost > 0
        ? capAnnualPayout / perStudentAnnualCost
        : null;
    const capPercentEnrollment =
      capActiveStudents != null && T != null && T > 0 ? capActiveStudents / T : null;

    const gapToCap = tdv != null && capTDV != null ? tdv - capTDV : null;

    const isBoardVoteSized = tdv != null ? tdv > 5_000_000 : false;

    return {
      E,
      T,
      Ppct,
      R,
      ipct,
      P,
      i,
      activeStudents,
      annualPayout,
      yieldFactor,
      tdv,
      eps,
      allocation,
      zone,
      feeRecoupYears,
      capPercent,
      capTDV,
      capActiveStudents,
      capPercentEnrollment,
      gapToCap,
      isBoardVoteSized,
    };
  }, [endowmentSize, interestRate, redemptionVelocity, studentEnrollment, targetReachPercent]);

  async function loadScenarios() {
    setLoadingScenarios(true);
    setLoadError("");
    try {
      // created_at may or may not exist; avoid hard-failing if it doesn't
      const first = await supabase
        .from("deal_scenarios")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (first.error) {
        const fallback = await supabase.from("deal_scenarios").select("*").limit(50);
        if (fallback.error) {
          setLoadError(fallback.error.message);
          setScenarios([]);
        } else {
          setScenarios((fallback.data as DealScenarioRow[]) ?? []);
        }
      } else {
        setScenarios((first.data as DealScenarioRow[]) ?? []);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load scenarios.");
      setScenarios([]);
    } finally {
      setLoadingScenarios(false);
    }
  }

  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") return;
    loadScenarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  function resetDraft() {
    setScenarioId(null);
    setScenarioName("");
    setUniversityName("");
    setEndowmentSize(2_000_000_000);
    setStudentEnrollment(30_000);
    setTargetReachPercent(20);
    setRedemptionVelocity(0.8);
    setInterestRate(3.25);
    setSaveError("");
    setSaved(false);
  }

  function loadScenario(row: DealScenarioRow) {
    setScenarioId(row.id ?? null);
    setScenarioName(row.name ?? "");
    setUniversityName(row.university_name ?? "");
    setEndowmentSize(Number(row.endowment_size ?? 0) || 0);
    setStudentEnrollment(Number(row.student_enrollment ?? 0) || 0);
    setTargetReachPercent(Number(row.target_reach_percent ?? 20) || 0);
    setRedemptionVelocity(Number(row.redemption_velocity ?? 0.8) || 0);
    setInterestRate(Number(row.interest_rate ?? 3.25) || 0);
    setSaveError("");
    setSaved(false);
  }

  async function saveScenario() {
    setSaved(false);
    setSaveError("");

    if (computed.zone !== "GREEN") {
      setSaveError("Only GREEN deals can be saved (Verified Deal).");
      return;
    }
    if (!universityName.trim()) {
      setSaveError("Enter an Institution / University Name.");
      return;
    }
    if (computed.E == null || computed.E <= 0) {
      setSaveError("Endowment must be greater than 0.");
      return;
    }
    if (computed.T == null || computed.T <= 0) {
      setSaveError("Enrollment must be greater than 0.");
      return;
    }
    if (computed.tdv == null || !Number.isFinite(computed.tdv)) {
      setSaveError("Could not compute TDV (check interest rate and inputs).");
      return;
    }

    setSaving(true);
    try {
      // Auto-generate name if blank
      const finalName = scenarioName.trim() || 
        `${universityName.trim() || "University"} Deal - ${new Date().toLocaleDateString()}`;

      const id = scenarioId ?? crypto.randomUUID();
      const payload = {
        id,
        name: finalName,
        university_name: universityName.trim(),
        endowment_size: computed.E,
        student_enrollment: Math.round(computed.T),
        target_reach_percent: clamp(targetReachPercent, 0, 100),
        redemption_velocity: redemptionVelocity,
        interest_rate: interestRate,
        calculated_tdv: computed.tdv,
        deal_zone: computed.zone,
      };

      const { error } = await supabase
        .from("deal_scenarios")
        .upsert(payload, { onConflict: "id" });

      if (error) {
        const errorMsg = `Database error: ${error.message}`;
        setSaveError(errorMsg);
        // Log serializable details (Supabase error doesn't stringify as {} in console)
        console.error("[Deal Desk] Save error:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        alert(errorMsg);
        return;
      }

      setScenarioId(id);
      setSaved(true);
      setScenarioName(""); // Clear the name field after successful save
      await loadScenarios();
      
      // Show success alert
      alert(`Scenario "${finalName}" saved successfully!`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Save failed.";
      setSaveError(errorMsg);
      console.error("[Deal Desk] Unexpected save error:", {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
      });
      alert(`Unexpected error: ${errorMsg}`);
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex w-full items-center justify-center bg-background py-16 text-muted-foreground">
        <div className="font-mono text-sm">AUTHENTICATING...</div>
      </div>
    );
  }

  if (userRole !== "SUPER_ADMIN") {
    return (
      <div className="flex w-full items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-xl rounded-2xl border border-accent bg-muted p-6">
          <h1 className="mb-2 text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            The Deal Desk is a SUPER_ADMIN-only sales tool.
          </p>
        </div>
      </div>
    );
  }

  const zone = computed.zone;

  const canCompute =
    computed.E != null &&
    computed.E > 0 &&
    computed.T != null &&
    computed.T > 0 &&
    computed.yieldFactor != null &&
    computed.yieldFactor > 0;

  const capStudents =
    computed.capActiveStudents != null ? Math.max(0, computed.capActiveStudents) : null;
  const showFastTrack = zone === "GREEN" && computed.tdv != null && computed.tdv <= 5_000_000;
  const showBoardVoteWarning = zone === "GREEN" && computed.isBoardVoteSized;
  const feeRecoupIsLong =
    computed.feeRecoupYears != null ? computed.feeRecoupYears > 10 : false;

  const dealScore = useMemo(() => {
    return computeDealScore({
      zone,
      eps: computed.eps,
      allocation: computed.allocation,
      feeRecoupYears: computed.feeRecoupYears,
      tdv: computed.tdv,
      canCompute,
    });
  }, [zone, computed.eps, computed.allocation, computed.feeRecoupYears, computed.tdv, canCompute]);

  const dealScoreClass =
    dealScore.score >= 90
      ? "text-success"
      : dealScore.score >= 75
        ? "text-blue-400"
        : dealScore.score >= 55
          ? "text-amber-400"
          : "text-destructive";

  return (
      <div className="mx-auto max-w-[98vw] px-4 py-8">
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div ref={hintRef} className="relative">
            <div className="text-xs font-mono text-muted-foreground">
              SALES QUALIFICATION / DEAL DESK
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">University Deal Desk</h1>
              <button
                type="button"
                onClick={() => setHintOpen((o) => !o)}
                aria-label="Explain everything (ELI5)"
                aria-expanded={hintOpen}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent bg-muted text-muted-foreground hover:bg-background/60 hover:text-foreground focus:ring-2 focus:ring-primary/20"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Grade affordability with a CFO-friendly “traffic light” using the Offbeat Yield Engine.
              No login required for students—this tool is internal only.
            </p>

            {hintOpen && (
              <div className="absolute left-0 top-full z-50 mt-2 max-h-[min(70vh,600px)] w-full min-w-[320px] max-w-2xl overflow-y-auto rounded-xl border border-accent bg-muted p-5 shadow-xl">
                <h3 className="mb-3 text-sm font-semibold text-foreground">
                  Explain like I&apos;m five — Deal Desk legend
                </h3>
                <ul className="space-y-4 text-sm text-muted-foreground">
                  <li>
                    <span className="font-mono font-semibold text-foreground">Institution name</span>
                    {" "}— The school or opportunity you&apos;re pricing.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Endowment (E)</span>
                    {" "}— How much money the school has saved (like a giant piggy bank).
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Student Enrollment (T)</span>
                    {" "}— How many students go there.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Target Reach (P)</span>
                    {" "}— What % of students you&apos;re trying to include in the pilot (e.g. 20%).
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Engagement / Redemption Velocity (R)</span>
                    {" "}— How many tokens per student per month you expect them to use.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Yield Rate (i)</span>
                    {" "}— The interest rate the school can earn on its money (like a savings account rate).
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Deal Score</span>
                    {" "}— A 1–100 grade: 1 = broken fit, 100 = perfect fit.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Fee Recoup Period</span>
                    {" "}— How many years until the yield from the deal pays back the 10% setup fee.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Total Deal Value (TDV)</span>
                    {" "}— How much of the endowment we use (as capital) for this deal.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Annual Payout</span>
                    {" "}— How much goes to students each year (mission budget).
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Active Students</span>
                    {" "}— Number of students in the pilot (enrollment × reach %).
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Endowment Per Student (EPS)</span>
                    {" "}— Endowment ÷ enrollment. Higher = richer school.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">Allocation %</span>
                    {" "}— TDV ÷ endowment. What % of the piggy bank this deal uses.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">GREEN / ORANGE / RED zone</span>
                    {" "}— Traffic light: Green = good fit, Orange = be careful (we recommend a cap), Red = misaligned with the school&apos;s affordability.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">FAST TRACK</span>
                    {" "}— Green deal under $5M; likely CFO approval without full board.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">BOARD VOTE LIKELY</span>
                    {" "}— TDV over $5M; board approval usually needed.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">K_eff = 0.567</span>
                    {" "}— A fixed number from the engine: it comes from 90% principal protection × 63% payout to students. It&apos;s the &quot;efficiency factor&quot; we use to size the deal so yield covers student rewards.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">9 months</span>
                    {" "}— Academic year (Sept–May) we use for token math.
                  </li>
                  <li>
                    <span className="font-mono font-semibold text-foreground">$25 token</span>
                    {" "}— Each student token is worth $25 when redeemed.
                  </li>
                </ul>
                <p className="mt-4 text-xs text-muted-foreground/80">
                  Click outside or press Escape to close.
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetDraft}
              className="rounded border border-accent bg-muted px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/60"
            >
              NEW DRAFT
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Inputs */}
          <section className="lg:col-span-7">
            <div className="rounded-2xl border border-accent bg-muted p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-wide">Inputs</h2>
                <div className="text-xs font-mono text-muted-foreground">
                  OYE: K<sub>eff</sub> = {EFFICIENCY_CONSTANT}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor="deal-university-name"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Institution / Opportunity Name
                  </label>
                  <input
                    id="deal-university-name"
                    name="universityName"
                    value={universityName}
                    onChange={(e) => setUniversityName(e.target.value)}
                    placeholder="e.g., University of Texas at Austin"
                    className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label
                    htmlFor="deal-endowment"
                    className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <PiggyBank className="h-4 w-4 text-accent" />
                    Endowment Size (E)
                  </label>
                  <input
                    id="deal-endowment"
                    name="endowmentSize"
                    type="number"
                    min={0}
                    step={1000000}
                    value={endowmentSize}
                    onChange={(e) => setEndowmentSize(Number(e.target.value))}
                    className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="mt-1 text-xs font-mono text-muted-foreground">
                    {computed.E != null ? currency0.format(computed.E) : "—"}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="deal-enrollment"
                    className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Users className="h-4 w-4 text-accent" />
                    Student Enrollment (T)
                  </label>
                  <input
                    id="deal-enrollment"
                    name="studentEnrollment"
                    type="number"
                    min={0}
                    step={100}
                    value={studentEnrollment}
                    onChange={(e) => setStudentEnrollment(Number(e.target.value))}
                    className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="mt-1 text-xs font-mono text-muted-foreground">
                    {computed.T != null ? number0.format(computed.T) : "—"} students
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="deal-target-reach"
                    className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"
                    title="Percent of the student body eligible for the pilot"
                  >
                    <GraduationCap className="h-4 w-4 text-accent" />
                    Target Reach (P) %
                  </label>
                  <input
                    id="deal-target-reach"
                    name="targetReachPercent"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={targetReachPercent}
                    onChange={(e) => setTargetReachPercent(Number(e.target.value))}
                    className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    Default 20% pilot reach
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="deal-engagement"
                    className="mb-1 block text-xs text-muted-foreground"
                    title="Projected tokens redeemed per student per month"
                  >
                    Engagement / Redemption Velocity (R)
                  </label>
                  <input
                    id="deal-engagement"
                    name="redemptionVelocity"
                    type="number"
                    min={0}
                    step={0.05}
                    value={redemptionVelocity}
                    onChange={(e) => setRedemptionVelocity(Number(e.target.value))}
                    className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    Default 0.8 tokens / student / month
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="deal-interest-rate"
                    className="mb-1 block text-xs text-muted-foreground"
                    title="Benchmark interest rate (yield environment)"
                  >
                    Yield Rate (i) %
                  </label>
                  <input
                    id="deal-interest-rate"
                    name="interestRate"
                    type="number"
                    min={0}
                    step={0.05}
                    value={interestRate}
                    onChange={(e) => setInterestRate(Number(e.target.value))}
                    className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    Default 3.25% market yield
                  </div>
                </div>
              </div>

              {saveError && (
                <p className="mt-4 text-sm text-destructive">{saveError}</p>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-accent/40 pt-6">
                <button
                  type="button"
                  onClick={saveScenario}
                  disabled={saving || zone !== "GREEN"}
                  className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving..." : zone === "GREEN" ? "Save Scenario" : "Save Locked"}
                </button>
              </div>

              {saved && (
                <p className="mt-3 text-sm text-success">
                  Saved scenario successfully.
                </p>
              )}
            </div>
          </section>

          {/* Right: Sticky Deal Card */}
          <aside className="lg:col-span-5">
            <div className="lg:sticky lg:top-6">
              <div className="rounded-2xl border border-accent bg-muted p-6">
                <div className="mb-6">
                  <label
                    htmlFor="deal-card-scenario-name"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Scenario Name
                  </label>
                  <input
                    id="deal-card-scenario-name"
                    name="scenarioName"
                    type="text"
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                    placeholder="e.g. Trinity University - Aggressive Pilot"
                    className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  {!scenarioName.trim() && (
                    <div className="mt-1 text-xs text-muted-foreground/80">
                      Will auto-generate: &quot;{universityName.trim() || "University"} Deal - {new Date().toLocaleDateString()}&quot;
                    </div>
                  )}
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">DEAL CARD</div>
                    <div className="mt-1 text-lg font-semibold">
                      {universityName.trim() || "Untitled Opportunity"}
                    </div>
                    <div className="mt-2">
                      <ZoneBadge zone={zone} />
                    </div>
                    {zone === "GREEN" && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {showFastTrack && (
                          <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                            <CheckCircle2 className="h-4 w-4" />
                            FAST TRACK
                            <span className="font-normal text-success/80">
                              (Likely CFO approval under $5M)
                            </span>
                          </span>
                        )}
                        {showBoardVoteWarning && (
                          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
                            <AlertTriangle className="h-4 w-4" />
                            BOARD VOTE LIKELY
                            <span className="font-normal text-amber-200/80">
                              (TDV over $5M)
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4">
                  <MetricRow
                    label="Deal Score"
                    subtitle="1 = broken. 100 = perfect fit."
                    value={`${dealScore.score} / 100`}
                    valueClassName={dealScoreClass}
                  />
                  <div className="px-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">Signal:</span>{" "}
                    <span className={dealScoreClass}>{dealScore.label}</span>
                  </div>
                  <MetricRow
                    label="Fee Recoup Period"
                    subtitle="Time until risk-free yield covers the 10% setup fee."
                    value={
                      computed.feeRecoupYears != null
                        ? `${computed.feeRecoupYears.toFixed(2)} Years`
                        : "—"
                    }
                    valueClassName={feeRecoupIsLong ? "text-destructive" : undefined}
                  />
                  <MetricRow
                    label="Total Deal Value (TDV)"
                    value={
                      computed.tdv != null ? currency0.format(computed.tdv) : "—"
                    }
                    valueClassName="text-blue-400"
                  />
                  <MetricRow
                    label="Annual Payout (Mission Budget)"
                    value={
                      computed.annualPayout != null
                        ? currency0.format(computed.annualPayout)
                        : "—"
                    }
                    valueClassName="text-success"
                  />
                  <MetricRow
                    label="Active Students (Pilot)"
                    value={
                      computed.activeStudents != null
                        ? number0.format(computed.activeStudents)
                        : "—"
                    }
                  />
                  <MetricRow
                    label="Endowment Per Student (EPS)"
                    value={computed.eps != null ? currency0.format(computed.eps) : "—"}
                  />
                  <MetricRow
                    label="Allocation % (TDV / Endowment)"
                    value={
                      computed.allocation != null ? percent2.format(computed.allocation) : "—"
                    }
                  />
                </div>

                {!canCompute && (
                  <div className="mt-6 rounded-xl border border-accent/50 bg-background/30 p-4 text-sm text-muted-foreground">
                    Enter <span className="font-mono">Endowment</span>,{" "}
                    <span className="font-mono">Enrollment</span>, and a non-zero{" "}
                    <span className="font-mono">Yield Rate</span> to compute TDV.
                  </div>
                )}

                {zone === "ORANGE" && canCompute && (
                  <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="text-xs font-mono text-amber-300">RECOMMENDED CAP (1.5% OF ENDOWMENT)</div>
                    <div className="mt-2 grid grid-cols-1 gap-3 text-sm text-amber-100">
                      <div className="flex items-center justify-between">
                        <span className="text-amber-200/80">Cap TDV</span>
                        <span className="font-mono font-semibold">
                          {computed.capTDV != null ? currency0.format(computed.capTDV) : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-amber-200/80">Students Served @ Cap</span>
                        <span className="font-mono font-semibold">
                          {capStudents != null ? number0.format(capStudents) : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-amber-200/80">% of Enrollment</span>
                        <span className="font-mono font-semibold">
                          {computed.capPercentEnrollment != null
                            ? percent2.format(computed.capPercentEnrollment)
                            : "—"}
                        </span>
                      </div>
                      {computed.gapToCap != null && computed.gapToCap > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-amber-200/80">Overage vs Cap</span>
                          <span className="font-mono font-semibold text-amber-200">
                            {currency0.format(computed.gapToCap)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 text-xs text-amber-200/80">
                      Recommendation: pitch the capped pilot size first, then scale as outcomes validate.
                    </div>
                  </div>
                )}

                {zone === "RED" && canCompute && (
                  <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                    <div className="text-xs font-mono text-destructive">REALITY GAP</div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      This ask is not aligned with the institution’s affordability band.
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Safety Cap (1.0%)</span>
                        <span className="font-mono">
                          {computed.capTDV != null ? currency0.format(computed.capTDV) : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Required TDV</span>
                        <span className="font-mono text-blue-400">
                          {computed.tdv != null ? currency0.format(computed.tdv) : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Gap vs Cap</span>
                        <span className="font-mono text-destructive">
                          {computed.gapToCap != null ? currency0.format(Math.max(0, computed.gapToCap)) : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </aside>
        </div>

        {/* Load Scenarios */}
        <section className="mt-10 rounded-2xl border border-accent bg-muted p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-wide">Saved Scenarios</h2>
              <p className="text-sm text-muted-foreground">
                Click a row to load it into the Deal Desk.
              </p>
            </div>
            <button
              type="button"
              onClick={loadScenarios}
              disabled={loadingScenarios}
              className="rounded border border-accent bg-muted px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/60 disabled:opacity-50"
            >
              {loadingScenarios ? "REFRESHING..." : "REFRESH"}
            </button>
          </div>

          {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}

          <div className="overflow-hidden rounded-xl border border-accent/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-background/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">University</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">TDV</th>
                  <th className="px-4 py-3">Allocation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-accent/40">
                {scenarios.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-sm text-muted-foreground">
                      {loadingScenarios ? "Loading..." : "No saved scenarios yet."}
                    </td>
                  </tr>
                ) : (
                  scenarios.map((s) => {
                    const E = safeNumber(s.endowment_size);
                    const tdv = safeNumber(s.calculated_tdv);
                    const alloc =
                      tdv != null && E != null && E > 0 ? tdv / E : null;
                    return (
                      <tr
                        key={s.id}
                        className="cursor-pointer hover:bg-background/40"
                        onClick={() => loadScenario(s)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold">
                            {s.name || s.university_name || "—"}
                          </div>
                          {s.name && s.university_name && (
                            <div className="text-xs text-muted-foreground">
                              {s.university_name}
                            </div>
                          )}
                          <div className="text-xs font-mono text-muted-foreground">
                            id: {s.id.slice(0, 8)}…
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <ZonePill zone={s.deal_zone ?? null} />
                        </td>
                        <td className="px-4 py-3 font-mono text-blue-400">
                          {tdv != null ? currency0.format(tdv) : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {alloc != null ? percent2.format(alloc) : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
  );
}

export default function DealDeskPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <DealDeskContent />
    </main>
  );
}

function ZonePill({ zone }: { zone: DealZone | null }) {
  if (zone === "GREEN") {
    return (
      <span className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs font-semibold text-success">
        GREEN
      </span>
    );
  }
  if (zone === "ORANGE") {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-400">
        ORANGE
      </span>
    );
  }
  if (zone === "RED") {
    return (
      <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
        RED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-accent/30 bg-background/40 px-2 py-1 text-xs font-semibold text-muted-foreground">
      —
    </span>
  );
}

function MetricRow({
  label,
  subtitle,
  value,
  valueClassName,
}: {
  label: string;
  subtitle?: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-accent/50 bg-background/30 px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        {subtitle && (
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            {subtitle}
          </div>
        )}
      </div>
      <div className={`font-mono text-sm font-semibold ${valueClassName ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

