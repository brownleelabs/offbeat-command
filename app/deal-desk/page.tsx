'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  PiggyBank,
  Save,
  Users,
  XCircle,
} from "lucide-react";
import { useDashboard } from "@/components/dashboard-context";
import {
  archiveDealScenarios,
  insertDealScenario,
  listDealScenarios,
  markDealScenarioViewed,
  softDeleteDealScenarios,
  updateDealScenarioPinned,
} from "./scenario-actions";

type DealZone = "GREEN" | "ORANGE" | "RED";

type DealScenarioRow = {
  id: string;
  name: string | null;
  university_name: string | null;
  endowment_size: number | null;
  student_enrollment: number | null;
  target_reach_percent: number | null;
  target_students: number | null;
  redemption_velocity: number | null;
  interest_rate: number | null;
  calculated_tdv: number | null;
  upfront_fee: number | null;
  projected_arr: number | null;
  /** Versioning / system-of-record */
  scenario_group_id?: string | null;
  version?: number | null;
  /** Immutable scoring snapshot at save-time */
  deal_score?: number | null;
  deal_score_label?: string | null;
  raw_economic_score?: number | null;
  score_breakdown?: unknown | null; // jsonb
  eps_at_save?: number | null;
  allocation_at_save?: number | null;
  fee_recoup_years_at_save?: number | null;
  /** Yield/waterfall snapshot at save-time */
  k_eff_at_save?: number | null;
  yield_environment?: string | null; // NORMAL | STEADY | EFFICIENT | FREEZE | UNKNOWN
  waterfall_shares?: unknown | null; // jsonb
  /** Scenario metadata */
  tags?: string[] | null;
  notes?: string | null;
  owner_user_id?: string | null;
  last_viewed_at?: string | null;
  /** Governance */
  pinned?: boolean | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deal_zone: DealZone | null;
  score_explanation: string | null;
  deal_summary: string | null;
  created_at?: string | null;
};

const ACADEMIC_MONTHS = 9;
const TOKEN_VALUE = 25;

// OYE / Economic Operating Zones (docs/economic_engine.md)
// Models fee sacrifice / waiver in low-yield environments.
function getYieldWaterfallShares(yieldRatePercent: number | null): {
  studentShare: number; // welfare
  operatorShare: number;
  protectionShare: number;
  kEff: number; // 0.90 * studentShare
} {
  // Defaults (Normal zone): 63/12/25 with 90% invested principal
  if (yieldRatePercent == null || !Number.isFinite(yieldRatePercent)) {
    const studentShare = 0.63;
    const operatorShare = 0.12;
    const protectionShare = 0.25;
    return { studentShare, operatorShare, protectionShare, kEff: 0.9 * studentShare };
  }

  // Zone 4 / Freeze: <0.1% yield => hard stop (token issuance effectively halts per OYE).
  // We set kEff=0 to prevent TDV sizing at near-zero yields.
  if (yieldRatePercent < 0.1) {
    const studentShare = 1.0;
    const operatorShare = 0.0;
    const protectionShare = 0.0;
    return { studentShare, operatorShare, protectionShare, kEff: 0 };
  }

  // Zone 3 / Efficient: 0.1%–1.5% => operator fee waived (0%), reinvestment paused (0%), 100% yield to students
  if (yieldRatePercent < 1.5) {
    const studentShare = 1.0;
    const operatorShare = 0.0;
    const protectionShare = 0.0;
    return { studentShare, operatorShare, protectionShare, kEff: 0.9 * studentShare };
  }

  // Zone 2 / Steady: 1.5%–2.0% => fee sacrifice (operator fee reduced to subsidize payouts)
  // We model this as operatorShare linearly ramping from 0% at 1.5% to 12% at 2.0%.
  if (yieldRatePercent < 2.0) {
    const operatorShare = ((yieldRatePercent - 1.5) / (2.0 - 1.5)) * 0.12; // 0..0.12
    const protectionShare = 0.25; // keep protection constant in Steady
    const studentShare = Math.max(0, 1.0 - protectionShare - operatorShare);
    return { studentShare, operatorShare, protectionShare, kEff: 0.9 * studentShare };
  }

  // Zone 1 / Normal: >2.0% => full stack
  const studentShare = 0.63;
  const operatorShare = 0.12;
  const protectionShare = 0.25;
  return { studentShare, operatorShare, protectionShare, kEff: 0.9 * studentShare };
}

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

function newUuid(): string {
  // Browser-safe UUID generation with fallback.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback (non-crypto); acceptable for client grouping only.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getYieldEnvironment(yieldRatePercent: number | null): "NORMAL" | "STEADY" | "EFFICIENT" | "FREEZE" | "UNKNOWN" {
  if (yieldRatePercent == null || !Number.isFinite(yieldRatePercent)) return "UNKNOWN";
  if (yieldRatePercent < 0.1) return "FREEZE";
  if (yieldRatePercent < 1.5) return "EFFICIENT";
  if (yieldRatePercent < 2.0) return "STEADY";
  return "NORMAL";
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

// --- Deal Score V3: Smooth curves + Context-aware friction ---

type Point = [number, number]; // [Input, OutputScore]

/**
 * Multi-point linear interpolation for smooth curves.
 * Allows defining a curve via X/Y checkpoints.
 */
function multiLerp(value: number, points: Point[]): number {
  // Clamp to edges
  if (value <= points[0][0]) return points[0][1];
  if (value >= points[points.length - 1][0]) return points[points.length - 1][1];

  // Find the segment and interpolate
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (value >= x1 && value <= x2) {
      return y1 + ((value - x1) * (y2 - y1)) / (x2 - x1);
    }
  }
  return points[points.length - 1][1];
}

/**
 * 1. EPS Score (Financial Depth)
 * Curve: Log-like ramp. <100k is fatal. 100k-500k is the steep climb. >3M is plateau.
 */
function getScoreEps(eps: number): number {
  const curve: Point[] = [
    [0, 0],
    [50_000, 10], // Danger zone
    [150_000, 35], // Viability floor
    [500_000, 75], // The "Sweet Spot" start
    [1_500_000, 92], // Elite
    [3_000_000, 100], // Saturation
  ];
  return multiLerp(eps, curve);
}

/**
 * 2. Allocation Score (The Cost)
 * Curve: "The Slide". <0.5% is free points. 1.0% is strong. 2.5% is the death line.
 */
function getScoreAllocation(allocation: number): number {
  const curve: Point[] = [
    [0.0, 100], // Free
    [0.005, 95], // <0.5% = Near Perfect
    [0.01, 80], // 1.0% = Solid
    [0.015, 60], // 1.5% = Friction starts
    [0.02, 35], // 2.0% = Heavy
    [0.025, 10], // 2.5% = Critical
    [0.035, 0], // >3.5% = Impossible
  ];
  return multiLerp(allocation, curve);
}

/**
 * 3. Recoup Score (The ROI)
 * Curve: "The Smooth Decay". <2y is perfect. 2-4y is the standard "Good" band. >7y falls off a cliff.
 */
function getScoreRecoup(years: number): number {
  const curve: Point[] = [
    [0.0, 100],
    [2.0, 100], // <2y is effectively maxed
    [3.0, 90], // 3y is still excellent
    [4.5, 75], // 4.5y is the "Okay" line
    [6.0, 45], // 6y is getting painful
    [8.0, 15], // 8y is bad
    [12.0, 0], // >12y is zero
  ];
  return multiLerp(years, curve);
}

/**
 * 4. Friction Score (Context Aware)
 * Takes the WORST of two scores:
 * A. Absolute TDV (Board Politics)
 * B. Relative TDV (Financial Risk as % of Endowment)
 */
function getScoreFriction(tdv: number, endowment: number): number {
  // A. Absolute Friction (Board Vote Sizing)
  const absCurve: Point[] = [
    [1_000_000, 100],
    [5_000_000, 90],
    [10_000_000, 70],
    [20_000_000, 40],
    [50_000_000, 10],
  ];
  const scoreAbs = multiLerp(tdv, absCurve);

  // B. Relative Friction (% of E)
  const fraction = endowment > 0 ? tdv / endowment : 0;
  const relCurve: Point[] = [
    [0.01, 100],
    [0.03, 85],
    [0.05, 60],
    [0.1, 20],
    [0.15, 0],
  ];
  const scoreRel = multiLerp(fraction, relCurve);

  // The friction is determined by the weakest link
  return Math.min(scoreAbs, scoreRel);
}

/**
 * A 1–100 sales qualification score (V3: smooth curves + context-aware friction).
 * Returns both finalScore (capped by zone) and rawEconomicScore (uncapped, for ranking).
 */
function computeDealScore(input: {
  zone: DealZone | null;
  eps: number | null;
  allocation: number | null; // decimal (0.015 = 1.5%)
  feeRecoupYears: number | null;
  tdv: number | null;
  endowment: number | null; // Required for context-aware friction
  canCompute: boolean;
}): { score: number; rawEconomicScore: number; label: string; breakdown: { s_eps: number; s_alloc: number; s_recoup: number; s_friction: number } | null } {
  const { zone, eps, allocation, feeRecoupYears, tdv, endowment, canCompute } = input;

  if (
    !canCompute ||
    zone == null ||
    eps == null ||
    allocation == null ||
    feeRecoupYears == null ||
    tdv == null ||
    endowment == null
  ) {
    return { score: 1, rawEconomicScore: 1, label: "MODEL INCOMPLETE", breakdown: null };
  }

  const s_eps = getScoreEps(eps);
  const s_alloc = getScoreAllocation(allocation);
  const s_recoup = getScoreRecoup(feeRecoupYears);
  const s_friction = getScoreFriction(tdv, endowment);

  // V3 Weights: EPS 35%, Allocation 30%, Recoup 20%, Friction 15%
  const rawEconomicScore =
    s_eps * 0.35 + s_alloc * 0.3 + s_recoup * 0.2 + s_friction * 0.15;

  // Zone caps (glass ceiling)
  let finalScore = rawEconomicScore;
  if (zone === "RED") {
    finalScore = Math.min(rawEconomicScore, 35);
  } else if (zone === "ORANGE") {
    finalScore = Math.min(rawEconomicScore, 75);
  }

  finalScore = clampScore(finalScore);
  const label =
    finalScore >= 90
      ? "HIGHEST PRIORITY"
      : finalScore >= 75
        ? "STRONG FIT"
        : finalScore >= 55
          ? "MODERATE FIT"
          : finalScore >= 35
            ? "LOW PRIORITY"
            : "LOWEST PRIORITY";

  return {
    score: finalScore,
    rawEconomicScore: Math.round(rawEconomicScore),
    label,
    breakdown: { s_eps, s_alloc, s_recoup, s_friction },
  };
}

/**
 * Human-readable English explanation of why this deal has its score.
 * Used for pre-sales qualification notes and tooltip.
 */
function getScoreExplanationEnglish(params: {
  zone: DealZone | null;
  eps: number | null;
  allocation: number | null;
  feeRecoupYears: number | null;
  tdv: number | null;
  endowment: number | null;
  breakdown: { s_eps: number; s_alloc: number; s_recoup: number; s_friction: number } | null;
  finalScore: number;
  rawEconomicScore: number;
}): string {
  const { zone, eps, allocation, feeRecoupYears, tdv, endowment, breakdown, finalScore, rawEconomicScore } = params;

  if (!breakdown || eps == null || allocation == null || feeRecoupYears == null || tdv == null || endowment == null) {
    return "Enter endowment, enrollment, and yield rate to see why this deal scores the way it does.";
  }

  // Focused tooltip explaining the signal (score label)
  const allocPct = (allocation * 100).toFixed(2);
  
  let explanation = "";
  
  // Explain what the signal means and why it got that score
  if (finalScore >= 90) {
    explanation = `HIGHEST PRIORITY (scores 90-100): This is an ideal target. `;
    if (zone === "GREEN") {
      explanation += `Strong financial depth and manageable allocation make this a top-tier opportunity worth prioritizing.`;
    } else {
      explanation += `Despite zone constraints, the underlying economics are excellent.`;
    }
  } else if (finalScore >= 75) {
    explanation = `STRONG FIT (scores 75-89): This is a solid target worth pursuing. `;
    if (zone === "ORANGE") {
      explanation += `Mid-market institution with some allocation pressure, but still viable.`;
    } else {
      explanation += `Good financial profile with reasonable deal terms.`;
    }
  } else if (finalScore >= 55) {
    explanation = `MODERATE FIT (scores 55-74): This is workable but not ideal. `;
    if (zone === "RED") {
      explanation += `Low endowment per student or high allocation creates challenges, but the deal structure may still be viable.`;
    } else {
      explanation += `Some financial constraints or deal complexity, but manageable with the right approach.`;
    }
  } else if (finalScore >= 35) {
    explanation = `LOW PRIORITY (scores 35-54): This requires careful consideration. `;
    if (zone === "RED") {
      explanation += `Tuition-dependent risk or high allocation makes this challenging.`;
    } else {
      explanation += `Financial constraints or deal complexity create significant hurdles.`;
    }
  } else {
    explanation = `LOWEST PRIORITY (scores 1-34): This is not recommended. `;
    if (eps < 150_000 && allocation > 0.02) {
      explanation += `Low endowment per student combined with high allocation makes this economically difficult.`;
    } else if (eps < 150_000) {
      explanation += `Low endowment per student ($${Math.round(eps / 1000)}k) indicates tuition-dependent risk.`;
    } else {
      explanation += `High allocation (${allocPct}%) exceeds recommended thresholds.`;
    }
    if (rawEconomicScore > 35) {
      explanation += ` The underlying economics score ${Math.round(rawEconomicScore)}, so it may still be worth a conversation.`;
    }
  }
  
  return explanation;
}

function ZoneBadge({ zone }: { zone: DealZone | null }) {
  if (zone === "GREEN") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
        <CheckCircle2 className="h-4 w-4" />
        PURSUE
      </span>
    );
  }
  if (zone === "ORANGE") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        CONSIDER
      </span>
    );
  }
  if (zone === "RED") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
        <XCircle className="h-4 w-4" />
        NOT FIT
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

  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioGroupId, setScenarioGroupId] = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState<string>("");
  const [universityName, setUniversityName] = useState<string>("");
  const [endowmentSize, setEndowmentSize] = useState<number>(2_000_000_000); // $2.0B baseline (ideal target)
  const [studentEnrollment, setStudentEnrollment] = useState<number>(10_000);
  const [targetReachPercent, setTargetReachPercent] = useState<number>(20);
  const [redemptionVelocity, setRedemptionVelocity] = useState<number>(1.0);
  const [interestRate, setInterestRate] = useState<number>(3.60);
  const [scenarioTagsInput, setScenarioTagsInput] = useState<string>("");
  const [scenarioNotes, setScenarioNotes] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>("");
  const [saved, setSaved] = useState(false);

  const [scenarios, setScenarios] = useState<DealScenarioRow[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState(false);
  const [loadError, setLoadError] = useState<string>("");
  const [scenarioTotal, setScenarioTotal] = useState<number>(0);
  const [scenarioPage, setScenarioPage] = useState<number>(1);
  const [scenarioPageSize, setScenarioPageSize] = useState<number>(50);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<Set<string>>(new Set());
  const [deletingScenarios, setDeletingScenarios] = useState(false);
  const [deleteError, setDeleteError] = useState<string>("");
  const [previewScenario, setPreviewScenario] = useState<DealScenarioRow | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [pinError, setPinError] = useState<string>("");
  const loadRequestIdRef = useRef(0);
  const filterDepsRef = useRef({ debouncedSearchQuery, showArchived, showDeleted, scenarioPageSize });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Any change in query filters resets pagination to page 1.
  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") return;
    setScenarioPage(1);
  }, [userRole, debouncedSearchQuery, showArchived, showDeleted, scenarioPageSize]);

  // Load the current page. When filters change, request page 1 (avoid stale page from closure).
  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") return;
    const filtersChanged =
      filterDepsRef.current.debouncedSearchQuery !== debouncedSearchQuery ||
      filterDepsRef.current.showArchived !== showArchived ||
      filterDepsRef.current.showDeleted !== showDeleted ||
      filterDepsRef.current.scenarioPageSize !== scenarioPageSize;
    if (filtersChanged) {
      filterDepsRef.current = { debouncedSearchQuery, showArchived, showDeleted, scenarioPageSize };
    }
    loadScenarios(filtersChanged ? 1 : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole, scenarioPage, scenarioPageSize, debouncedSearchQuery, showArchived, showDeleted]);

  const computed = useMemo(() => {
    const E = safeNumber(endowmentSize);
    const T = safeNumber(studentEnrollment);
    const Ppct = safeNumber(targetReachPercent);
    const R = safeNumber(redemptionVelocity);
    const ipct = safeNumber(interestRate);

    const P = Ppct == null ? null : clamp(Ppct, 0, 100) / 100;
    const i = ipct == null ? null : ipct / 100;

    const shares = getYieldWaterfallShares(ipct);

    // Use integer participants (matches saved `target_students` rounding)
    const activeStudents =
      T != null && P != null && T > 0 ? Math.round(T * P) : null;

    const annualPayout =
      activeStudents != null && R != null
        ? activeStudents * (R * ACADEMIC_MONTHS) * TOKEN_VALUE
        : null;

    // Yield factor uses K_eff = 0.90 * studentShare (varies by yield environment in low-rate zones)
    const yieldFactor = i != null ? shares.kEff * i : null;

    const tdv =
      annualPayout != null && yieldFactor != null && yieldFactor > 0
        ? annualPayout / yieldFactor
        : null;

    // OYE model: 10% upfront fee is taken from TDV principal; 90% is invested.
    // docs/economic_engine.md: K_eff = 0.90 * 0.63 = 0.567, and TDV sizing uses r_deal on invested principal.
    const investedPrincipal = tdv != null ? tdv * 0.9 : null;

    // Annual yield on invested principal (percent -> decimal already: i)
    const annualYield = investedPrincipal != null && i != null ? investedPrincipal * i : null;

    // Operator economics (share varies by yield environment; matches saved annual_operator_revenue)
    const projectedArr = annualYield != null ? annualYield * shares.operatorShare : null;

    // Upfront fee (10% of TDV) and its recoup time is modeled by feeRecoupYears = upfrontFee / annualYield
    const upfrontFee = tdv != null ? tdv * 0.1 : null;

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
      annualYield,
      upfrontFee,
      projectedArr,
      kEff: shares.kEff,
      shares,
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

  async function loadScenarios(overridePage?: number) {
    const requestId = ++loadRequestIdRef.current;
    const pageToLoad = overridePage ?? scenarioPage;
    setLoadingScenarios(true);
    setLoadError("");
    setDeleteError("");
    setPinError("");
    try {
      const res = await listDealScenarios<DealScenarioRow>({
        page: pageToLoad,
        pageSize: scenarioPageSize,
        searchQuery: debouncedSearchQuery,
        showArchived,
        showDeleted,
      });

      if (loadRequestIdRef.current !== requestId) return;
      if (!res.success) {
        setLoadError(res.error);
        setScenarios([]);
        setScenarioTotal(0);
        return;
      }

      const total = res.total ?? 0;
      const maxPage = Math.max(1, Math.ceil(total / scenarioPageSize));
      if (pageToLoad > maxPage) {
        const res2 = await listDealScenarios<DealScenarioRow>({
          page: maxPage,
          pageSize: scenarioPageSize,
          searchQuery: debouncedSearchQuery,
          showArchived,
          showDeleted,
        });
        if (loadRequestIdRef.current !== requestId) return;
        if (!res2.success) {
          setLoadError(res2.error);
          setScenarios([]);
          setScenarioTotal(0);
          return;
        }
        setScenarioPage(maxPage);
        setScenarios(res2.rows ?? []);
        setScenarioTotal(res2.total ?? 0);
      } else {
        setScenarios(res.rows ?? []);
        setScenarioTotal(total);
      }
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return;
      setLoadError(err instanceof Error ? err.message : "Failed to load scenarios.");
      setScenarios([]);
      setScenarioTotal(0);
    } finally {
      if (loadRequestIdRef.current === requestId) setLoadingScenarios(false);
    }
  }

  // All filtering/searching happens server-side now; the UI operates on the current page.
  const visibleScenarios = scenarios;

  const visibleScenarioIds = useMemo(() => new Set(visibleScenarios.map((s) => s.id)), [visibleScenarios]);

  // Safety: actions should apply to what the user can currently see.
  // This prevents “hidden selections” after you change search/toggles.
  const selectedVisibleIds = useMemo(() => {
    const ids = Array.from(selectedScenarioIds).filter((id) => visibleScenarioIds.has(id));
    return new Set(ids);
  }, [selectedScenarioIds, visibleScenarioIds]);

  function toggleScenarioSelection(id: string) {
    setSelectedScenarioIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllScenarios(checked: boolean) {
    if (checked) {
      setSelectedScenarioIds(new Set(visibleScenarios.map((s) => s.id)));
    } else {
      setSelectedScenarioIds(new Set());
    }
  }

  async function deleteSelectedScenarios() {
    if (selectedVisibleIds.size === 0) return;
    setDeletingScenarios(true);
    setDeleteError("");
    try {
      const ids = Array.from(selectedVisibleIds);
      // Soft delete (system of record): keep rows, hide by default.
      const res = await softDeleteDealScenarios(ids, true);
      if (!res.success) {
        setDeleteError(res.error);
        return;
      }
      // Keep the affected rows visible after the action.
      setShowDeleted(true);
      setShowArchived(false);
      setSelectedScenarioIds(new Set());
      await loadScenarios();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete scenarios.");
    } finally {
      setDeletingScenarios(false);
    }
  }

  async function archiveSelectedScenarios() {
    if (selectedVisibleIds.size === 0) return;
    setDeletingScenarios(true);
    setDeleteError("");
    try {
      const ids = Array.from(selectedVisibleIds);
      // Archiving and deleting are mutually exclusive states:
      // - Archive clears deleted flags (so "Show archived" reliably reveals it)
      const res = await archiveDealScenarios(ids, true);
      if (!res.success) {
        setDeleteError(res.error);
        return;
      }
      // Keep the affected rows visible after the action.
      setShowArchived(true);
      setShowDeleted(false);
      setSelectedScenarioIds(new Set());
      await loadScenarios();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to archive scenarios.");
    } finally {
      setDeletingScenarios(false);
    }
  }

  async function restoreSelectedScenarios() {
    if (selectedVisibleIds.size === 0) return;
    setDeletingScenarios(true);
    setDeleteError("");
    try {
      const ids = Array.from(selectedVisibleIds);
      const res = await softDeleteDealScenarios(ids, false);
      if (!res.success) {
        setDeleteError(res.error);
        return;
      }
      setShowDeleted(false);
      setSelectedScenarioIds(new Set());
      await loadScenarios();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to restore scenarios.");
    } finally {
      setDeletingScenarios(false);
    }
  }

  async function unarchiveSelectedScenarios() {
    if (selectedVisibleIds.size === 0) return;
    setDeletingScenarios(true);
    setDeleteError("");
    try {
      const ids = Array.from(selectedVisibleIds);
      const res = await archiveDealScenarios(ids, false);
      if (!res.success) {
        setDeleteError(res.error);
        return;
      }
      setShowArchived(false);
      setSelectedScenarioIds(new Set());
      await loadScenarios();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to unarchive scenarios.");
    } finally {
      setDeletingScenarios(false);
    }
  }

  async function togglePinnedScenario(row: DealScenarioRow) {
    setPinError("");
    try {
      const nextPinned = !(row.pinned ?? false);
      const res = await updateDealScenarioPinned(row.id, nextPinned);
      if (!res.success) {
        setPinError(res.error);
        return;
      }
      await loadScenarios();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Pin update failed.");
    }
  }

  async function markScenarioViewed(row: DealScenarioRow) {
    try {
      await markDealScenarioViewed(row.id);
    } catch {
      // ignore
    }
  }

  function resetDraft() {
    setScenarioId(null);
    setScenarioGroupId(null);
    setScenarioName("");
    setUniversityName("");
    setEndowmentSize(2_000_000_000);
    setStudentEnrollment(10_000);
    setTargetReachPercent(20);
    setRedemptionVelocity(1.0);
    setInterestRate(3.60);
    setScenarioTagsInput("");
    setScenarioNotes("");
    setSaveError("");
    setSaved(false);
  }

  function loadScenario(row: DealScenarioRow) {
    setScenarioId(row.id ?? null);
    setScenarioGroupId(row.scenario_group_id ?? null);
    setScenarioName(row.name ?? "");
    setUniversityName(row.university_name ?? "");
    setEndowmentSize(Number(row.endowment_size ?? 0) || 0);
    setStudentEnrollment(Number(row.student_enrollment ?? 0) || 0);
    setTargetReachPercent(Number(row.target_reach_percent ?? 20) || 0);
    setRedemptionVelocity(Number(row.redemption_velocity ?? 1.0) || 0);
    setInterestRate(Number(row.interest_rate ?? 3.60) || 0);
    setScenarioTagsInput((row.tags ?? []).join(", "));
    setScenarioNotes(row.notes ?? "");
    setSaveError("");
    setSaved(false);
  }

  function duplicateScenarioIntoDraft(row: DealScenarioRow) {
    // Duplicate should always create a new record on save (we already do immutable inserts).
    // Keep the group id to create a clean version chain, unless missing (then create one).
    setScenarioId(null);
    setScenarioGroupId(row.scenario_group_id ?? newUuid());
    setScenarioName(
      row.name
        ? `${row.name} — Iteration`
        : row.university_name
          ? `${row.university_name} — Iteration`
          : ""
    );
    setUniversityName(row.university_name ?? "");
    setEndowmentSize(Number(row.endowment_size ?? 0) || 0);
    setStudentEnrollment(Number(row.student_enrollment ?? 0) || 0);
    setTargetReachPercent(Number(row.target_reach_percent ?? 20) || 0);
    setRedemptionVelocity(Number(row.redemption_velocity ?? 1.0) || 0);
    setInterestRate(Number(row.interest_rate ?? 3.60) || 0);
    setScenarioTagsInput((row.tags ?? []).join(", "));
    setScenarioNotes(row.notes ?? "");
    setSaveError("");
    setSaved(false);
  }

  async function saveScenario() {
    setSaved(false);
    setSaveError("");

    if (!universityName.trim()) {
      setSaveError("Enter an Institution Name.");
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
    if (computed.activeStudents == null || computed.activeStudents <= 0) {
      setSaveError("Students Expected to Participate must be greater than 0 (check Target Reach %).");
      return;
    }
    if (computed.tdv == null || !Number.isFinite(computed.tdv)) {
      setSaveError("Could not compute TDV (check interest rate and inputs).");
      return;
    }
    if (computed.tdv <= 0) {
      setSaveError("TDV must be greater than 0 (check Target Reach %, engagement, and yield rate).");
      return;
    }

    setSaving(true);
    try {
      // Auto-generate name if blank
      const finalName =
        scenarioName.trim() ||
        `${universityName.trim() || "University"} Deal - ${new Date().toLocaleDateString()}`;

      // Group/version: each save is immutable; group_id ties versions together.
      const finalGroupId = scenarioGroupId ?? newUuid();

      // Required DB fields:
      // - target_students (Students Expected to Participate)
      // - assumed_yield_rate (stored as percentage, e.g. 3.25 for 3.25%)
      const activeStudentsCount = computed.activeStudents;

      // Optional convenience metric (decimal -> percent)
      const allocationPercent =
        computed.allocation != null ? computed.allocation * 100 : null;

      // Legacy NOT NULL metrics used by the original Pricing tab:
      // - annual_student_welfare
      // - annual_operator_revenue
      // - annual_principal_protection
      //
      // OYE model:
      // - 10% upfront fee is taken from TDV principal
      // - 90% of TDV is invested to earn yield (docs/economic_engine.md: K_eff = 0.90 * 0.63)
      // Annual yield is computed on invested principal, then split by the yield waterfall.
      const yieldRateDecimal = interestRate / 100;
      const tdv = computed.tdv!;
      const annualYield = tdv * 0.9 * yieldRateDecimal;
      const shares = getYieldWaterfallShares(interestRate);
      const annualStudentWelfare = annualYield * shares.studentShare;
      const annualOperatorRevenue = annualYield * shares.operatorShare;
      const annualPrincipalProtection = annualYield * shares.protectionShare;

      // Pre-sales qualification note: why this deal has this score (for deal makers)
      const scoreExplanation = getScoreExplanationEnglish({
        zone: computed.zone,
        eps: computed.eps,
        allocation: computed.allocation,
        feeRecoupYears: computed.feeRecoupYears ?? null,
        tdv: computed.tdv ?? null,
        endowment: computed.E ?? null,
        breakdown: dealScore.breakdown ?? null,
        finalScore: dealScore.score,
        rawEconomicScore: dealScore.rawEconomicScore,
      });

      // Generate deal summary text for saving
      const dealSummaryText = generateDealSummaryText();

      const tags = scenarioTagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const payload = {
        name: finalName,
        // snake_case DB columns
        university_name: universityName.trim(),
        endowment_size: computed.E,
        student_enrollment: Math.round(computed.T),
        target_reach_percent: clamp(targetReachPercent, 0, 100),
        redemption_velocity: redemptionVelocity,
        // For compatibility with existing schema used in Pricing tab:
        // - assumed_yield_rate is the legacy column name (NOT NULL constraint)
        // - interest_rate is a more explicit alias we also persist
        assumed_yield_rate: interestRate,
        interest_rate: interestRate,
        target_students: activeStudentsCount,
        // Persist TDV under both the legacy `tdv_amount` column and the newer `calculated_tdv`
        // so existing dashboards and any new consumers can read it.
        tdv_amount: tdv,
        calculated_tdv: tdv,
        upfront_fee: computed.upfrontFee,
        projected_arr: computed.projectedArr,
        // system-of-record grouping/versioning
        scenario_group_id: finalGroupId,
        // scoring snapshot (immutable)
        deal_score: dealScore.score,
        deal_score_label: dealScore.label,
        raw_economic_score: dealScore.rawEconomicScore,
        score_breakdown: dealScore.breakdown,
        eps_at_save: computed.eps,
        allocation_at_save: computed.allocation,
        fee_recoup_years_at_save: computed.feeRecoupYears,
        // yield/waterfall snapshot (immutable)
        k_eff_at_save: computed.kEff,
        yield_environment: getYieldEnvironment(interestRate),
        waterfall_shares: computed.shares,
        // scenario metadata
        tags: tags.length ? tags : null,
        notes: scenarioNotes.trim() ? scenarioNotes.trim() : null,
        pinned: false,
        annual_student_welfare: annualStudentWelfare,
        annual_operator_revenue: annualOperatorRevenue,
        annual_principal_protection: annualPrincipalProtection,
        allocation_percent: allocationPercent,
        deal_zone: computed.zone,
        score_explanation: scoreExplanation,
        deal_summary: dealSummaryText,
      };

      const res = await insertDealScenario(payload as Record<string, unknown>);
      if (!res.success) {
        const errorMsg = `Database error: ${res.error}`;
        setSaveError(errorMsg);
        console.error("[Deal Desk] Save error:", errorMsg);
        alert(errorMsg);
        return;
      }

      // Use the freshly created row's id (if returned) as the current in-memory scenario id.
      // This is mainly for UI consistency; every save still creates a new immutable record.
      setScenarioId(res.id ?? null);
      setScenarioGroupId(finalGroupId);
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
    computed.yieldFactor > 0 &&
    computed.activeStudents != null &&
    computed.activeStudents > 0 &&
    computed.annualPayout != null &&
    computed.annualPayout > 0 &&
    computed.tdv != null &&
    computed.tdv > 0;

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
      endowment: computed.E,
      canCompute,
    });
  }, [zone, computed.eps, computed.allocation, computed.feeRecoupYears, computed.tdv, computed.E, canCompute]);

  const scenarioPageCount = Math.max(1, Math.ceil(scenarioTotal / scenarioPageSize));
  const scenarioShowingFrom = scenarioTotal === 0 ? 0 : (scenarioPage - 1) * scenarioPageSize + 1;
  const scenarioShowingTo = Math.min(scenarioTotal, scenarioPage * scenarioPageSize);

  const dealScoreClass =
    dealScore.score >= 90
      ? "text-success"
      : dealScore.score >= 75
        ? "text-blue-400"
        : dealScore.score >= 55
          ? "text-amber-400"
          : "text-destructive";

  const zoneStatus =
    zone === "GREEN" ? "PURSUE" : zone === "ORANGE" ? "CONSIDER" : zone === "RED" ? "NOT FIT" : "INCOMPLETE";

  const dealScoreExplanation = useMemo(() => {
    return getScoreExplanationEnglish({
      zone,
      eps: computed.eps,
      allocation: computed.allocation,
      feeRecoupYears: computed.feeRecoupYears,
      tdv: computed.tdv,
      endowment: computed.E,
      breakdown: dealScore.breakdown ?? null,
      finalScore: dealScore.score,
      rawEconomicScore: dealScore.rawEconomicScore,
    });
  }, [zone, computed.eps, computed.allocation, computed.feeRecoupYears, computed.tdv, computed.E, dealScore.breakdown, dealScore.score, dealScore.rawEconomicScore]);

  // Derived metrics for the saved-scenario preview modal (non-mutating).
  // Prefer persisted columns, but keep fallbacks for older rows.
  const previewDerived = useMemo(() => {
    if (!previewScenario) return null;

    const E = safeNumber(previewScenario.endowment_size);
    const T = safeNumber(previewScenario.student_enrollment);
    const tdv = safeNumber(previewScenario.calculated_tdv);

    const alloc = tdv != null && E != null && E > 0 ? tdv / E : null;
    const eps = E != null && T != null && T > 0 ? E / T : null;

    const upfrontFee =
      previewScenario.upfront_fee != null
        ? previewScenario.upfront_fee
        : tdv != null
          ? tdv * 0.1
          : null;

    const ipct = safeNumber(previewScenario.interest_rate);
    const i = ipct != null ? ipct / 100 : null;
    const shares = getYieldWaterfallShares(ipct);

    const investedPrincipal = tdv != null ? tdv * 0.9 : null;
    const annualYield =
      investedPrincipal != null && i != null ? investedPrincipal * i : null;

    const projectedArr =
      previewScenario.projected_arr != null
        ? previewScenario.projected_arr
        : annualYield != null
          ? annualYield * shares.operatorShare
          : null;

    const feeRecoupYears =
      ipct != null && ipct > 0 ? 1 / (ACADEMIC_MONTHS * (ipct / 100)) : null;

    const canComputePreview =
      (previewScenario.deal_zone ?? null) != null &&
      eps != null &&
      alloc != null &&
      feeRecoupYears != null &&
      tdv != null &&
      E != null;

    const computedScore = canComputePreview
      ? computeDealScore({
          zone: previewScenario.deal_zone ?? null,
          eps,
          allocation: alloc,
          feeRecoupYears,
          tdv,
          endowment: E,
          canCompute: true,
        })
      : null;

    // Prefer persisted snapshot if present (model evolves; record should remain explainable).
    const dealScore =
      previewScenario.deal_score != null
        ? {
            score: Math.round(previewScenario.deal_score),
            rawEconomicScore:
              previewScenario.raw_economic_score != null
                ? Math.round(previewScenario.raw_economic_score)
                : computedScore?.rawEconomicScore ?? 1,
            label: previewScenario.deal_score_label ?? computedScore?.label ?? "MODEL INCOMPLETE",
          }
        : computedScore;

    const dealScoreClass =
      dealScore == null
        ? "text-muted-foreground"
        : dealScore.score >= 90
          ? "text-success"
          : dealScore.score >= 75
            ? "text-blue-400"
            : dealScore.score >= 55
              ? "text-amber-400"
              : "text-destructive";

    const zoneStatus =
      previewScenario.deal_zone === "GREEN"
        ? "pursue"
        : previewScenario.deal_zone === "ORANGE"
          ? "consider"
          : previewScenario.deal_zone === "RED"
            ? "not fit"
            : "incomplete";

    const feeRecoupIsLong = feeRecoupYears != null ? feeRecoupYears > 10 : false;

    return {
      tdv,
      alloc,
      upfrontFee,
      projectedArr,
      feeRecoupYears,
      feeRecoupIsLong,
      dealScore,
      dealScoreClass,
      zoneStatus,
    };
  }, [previewScenario]);

  /**
   * Generate deal summary as plain text (for saving to database)
   */
  function generateDealSummaryText(): string {
    if (!canCompute || computed.tdv == null || computed.annualPayout == null || computed.activeStudents == null || computed.annualYield == null) {
      return "";
    }

    const inst = universityName.trim() || "this institution";
    const basePrincipal = computed.tdv * 0.9;
    const upfrontFee = computed.upfrontFee ?? computed.tdv * 0.1;
    const annualYield = computed.annualYield;
    const monthlyYield = annualYield / 12;
    const studentShareMonthly = monthlyYield * computed.shares.studentShare;
    const operatorShareMonthly = monthlyYield * computed.shares.operatorShare;
    const protectionShareMonthly = monthlyYield * computed.shares.protectionShare;
    const tokensPerStudentPerMonth = redemptionVelocity;
    const totalTokensPerMonth = computed.activeStudents * tokensPerStudentPerMonth;

    const zoneStatusText = zone === "GREEN" ? "pursue" : zone === "ORANGE" ? "consider" : zone === "RED" ? "not fit" : "incomplete";

    const parts: string[] = [];

    parts.push(`Deal Summary`);
    parts.push(`The Offbeat Yield Engine (OYE) classifies this opportunity as ${zoneStatusText} with a Deal Score of ${dealScore.score}/100. This deal is ${dealScore.label.toLowerCase()}.`);
    parts.push(`This opportunity requires ${inst} to invest a Total Deal Value (TDV) of ${currency0.format(computed.tdv)}. Of this total, 90% (${currency0.format(basePrincipal)}) is invested as the base principal to generate yield, while 10% (${currency0.format(upfrontFee)}) is paid to Offbeat Options as a one-time upfront fee. The projected Annual Recurring Revenue (ARR) to Offbeat Options is ${computed.projectedArr != null ? currency0.format(computed.projectedArr) : "—"} per year.`);
    parts.push(`This program delivers approximately ${currency0.format(computed.annualPayout)} annually in student rewards, distributed to roughly ${number0.format(computed.activeStudents)} participating students through approximately ${number0.format(totalTokensPerMonth)} $${TOKEN_VALUE} redeemable tokens issued per month.`);
    parts.push(`From a financial perspective, this deal represents approximately ${computed.allocation != null ? percent2.format(computed.allocation) : "—"} of ${inst}'s total endowment. The institution's Endowment Per Student (EPS) is approximately ${computed.eps != null ? currency0.format(computed.eps) : "—"}. The upfront fee will be recouped through yield earnings in approximately ${computed.feeRecoupYears != null ? `${computed.feeRecoupYears.toFixed(2)} years` : "—"}.`);
    parts.push(`Yield Distribution: The monthly yield generated from the ${currency0.format(basePrincipal)} invested principal is distributed according to a ${Math.round(computed.shares.studentShare * 100)}/${Math.round(computed.shares.operatorShare * 100)}/${Math.round(computed.shares.protectionShare * 100)} split: ${Math.round(computed.shares.studentShare * 100)}% (${currency0.format(studentShareMonthly)} per month) funds student token liquidity and rewards, ${Math.round(computed.shares.operatorShare * 100)}% (${currency0.format(operatorShareMonthly)} per month) flows to Offbeat Options as recurring revenue, and ${Math.round(computed.shares.protectionShare * 100)}% (${currency0.format(protectionShareMonthly)} per month) is reinvested back into the principal to maintain the investment base.`);

    return parts.join("\n\n");
  }

  const executiveSummary = useMemo(() => {
    if (!canCompute || computed.tdv == null || computed.annualPayout == null || computed.activeStudents == null || computed.annualYield == null) {
      return (
        <p className="text-muted-foreground">
          Enter Institution Name, Endowment, Enrollment, Reach %, Engagement, and Yield Rate to generate an executive summary for this deal.
        </p>
      );
    }

    const inst = universityName.trim() || "this institution";
    const basePrincipal = computed.tdv * 0.9;
    const upfrontFee = computed.upfrontFee ?? computed.tdv * 0.1;
    const annualYield = computed.annualYield;
    const monthlyYield = annualYield / 12;
    const studentShareMonthly = monthlyYield * computed.shares.studentShare;
    const operatorShareMonthly = monthlyYield * computed.shares.operatorShare;
    const protectionShareMonthly = monthlyYield * computed.shares.protectionShare;
    const tokensPerStudentPerMonth = redemptionVelocity; // tokens per student per month
    const totalTokensPerMonth = computed.activeStudents * tokensPerStudentPerMonth; // total number of tokens per month

    // Helper component for colored dynamic values
    const DynamicValue = ({ children, className = "text-blue-400 font-semibold" }: { children: ReactNode; className?: string }) => (
      <span className={className}>{children}</span>
    );

    return (
      <div className="space-y-3 leading-relaxed">
        <p>
          The Offbeat Yield Engine (OYE) classifies this opportunity as{" "}
          <DynamicValue className={zone === "GREEN" ? "text-success font-semibold" : zone === "ORANGE" ? "text-amber-400 font-semibold" : "text-destructive font-semibold"}>
            {zoneStatus.toLowerCase()}
          </DynamicValue>{" "}
          with a Deal Score of{" "}
          <DynamicValue className={dealScoreClass}>
            {dealScore.score}/100
          </DynamicValue>
          . This deal is{" "}
          <DynamicValue className={dealScoreClass}>
            {dealScore.label.toLowerCase()}
          </DynamicValue>
          .
        </p>
        <p>
          This opportunity requires {inst} to invest a Total Deal Value (TDV) of{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {currency0.format(computed.tdv)}
          </DynamicValue>
          . Of this total, 90% ({" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {currency0.format(basePrincipal)}
          </DynamicValue>
          ) is invested as the base principal to generate yield, while 10% ({" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {currency0.format(upfrontFee)}
          </DynamicValue>
          ) is paid to Offbeat Options as a one-time upfront fee. The projected Annual Recurring Revenue (ARR) to Offbeat Options is{" "}
          <DynamicValue className="text-amber-400 font-semibold">
            {computed.projectedArr != null ? currency0.format(computed.projectedArr) : "—"}
          </DynamicValue>{" "}
          per year.
        </p>
        <p>
          This program delivers approximately{" "}
          <DynamicValue className="text-success font-semibold">
            {currency0.format(computed.annualPayout)}
          </DynamicValue>{" "}
          annually in student rewards, distributed to roughly{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {number0.format(computed.activeStudents)}
          </DynamicValue>{" "}
          participating students through approximately{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {number0.format(totalTokensPerMonth)}
          </DynamicValue>{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            ${TOKEN_VALUE}
          </DynamicValue>{" "}
          redeemable tokens issued per month.
        </p>
        <p>
          From a financial perspective, this deal represents approximately{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {computed.allocation != null ? percent2.format(computed.allocation) : "—"}
          </DynamicValue>{" "}
          of {inst}'s total endowment. The institution's Endowment Per Student (EPS) is approximately{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {computed.eps != null ? currency0.format(computed.eps) : "—"}
          </DynamicValue>
          . The upfront fee will be recouped through yield earnings in approximately{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {computed.feeRecoupYears != null ? `${computed.feeRecoupYears.toFixed(2)} years` : "—"}
          </DynamicValue>
          .
        </p>
        <p>
          <span className="font-semibold">Yield Distribution:</span> The monthly yield generated from the{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {currency0.format(basePrincipal)}
          </DynamicValue>{" "}
          invested principal is distributed according to a{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {Math.round(computed.shares.studentShare * 100)}/{Math.round(computed.shares.operatorShare * 100)}/{Math.round(computed.shares.protectionShare * 100)}
          </DynamicValue>{" "}
          split:{" "}
          <DynamicValue className="text-success font-semibold">
            {Math.round(computed.shares.studentShare * 100)}%
          </DynamicValue>{" "}
          (<DynamicValue className="text-success font-semibold">
            {currency0.format(studentShareMonthly)}
          </DynamicValue>{" "}
          per month) funds student token liquidity and rewards,{" "}
          <DynamicValue className="text-amber-400 font-semibold">
            {Math.round(computed.shares.operatorShare * 100)}%
          </DynamicValue>{" "}
          (<DynamicValue className="text-amber-400 font-semibold">
            {currency0.format(operatorShareMonthly)}
          </DynamicValue>{" "}
          per month) flows to Offbeat Options as recurring revenue, and{" "}
          <DynamicValue className="text-blue-400 font-semibold">
            {Math.round(computed.shares.protectionShare * 100)}%
          </DynamicValue>{" "}
          (<DynamicValue className="text-blue-400 font-semibold">
            {currency0.format(protectionShareMonthly)}
          </DynamicValue>{" "}
          per month) is reinvested back into the principal to maintain the investment base.
        </p>
      </div>
    );
  }, [
    canCompute,
    universityName,
    computed.tdv,
    computed.annualPayout,
    computed.activeStudents,
    computed.upfrontFee,
    computed.projectedArr,
    computed.allocation,
    computed.eps,
    computed.feeRecoupYears,
    computed.annualYield,
    computed.shares,
    zoneStatus,
    dealScore.score,
    dealScore.label,
    dealScoreClass,
    zone,
    redemptionVelocity,
  ]);

  return (
      <div className="mx-auto max-w-[98vw] px-4 py-8">
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Campus Mobility Project Deal Qualification Desk</h1>
            <InlineHelp
              ariaLabel="Deal Desk legend (definitions)"
              heading="Deal Desk legend (definitions)"
              text="Institution Name — The school or opportunity you're evaluating. Endowment (E) — The institution's total reported endowment (USD). Student Enrollment (T) — Total student enrollment. Target Reach (P) — Percent of students expected to be eligible/participate (e.g., 20%). Engagement / Redemption Velocity (R) — Expected tokens redeemed per participating student per month. Yield Rate (i) — Assumed annual yield environment used for sizing (percent). Deal Score — A 1–100 qualification score: 1 = poor fit, 100 = excellent fit. Fee Recoup Period — Time until risk-free yield covers the 10% upfront fee. Total Deal Value (TDV) — Capital allocated for the deal (USD), sized by the engine. Annual Reward Dollars to Students — Estimated annual rewards delivered directly to students (USD). Students Expected to Participate — Estimated participants (Enrollment × Reach %). Endowment Per Student (EPS) — Endowment ÷ enrollment (proxy for affordability/financial depth). Allocation % — TDV ÷ endowment (percent of endowment allocated to the deal). GREEN / ORANGE / RED zone — Status band: Green = Pursue; Orange = Consider; Red = Not Fit. FAST TRACK — Green deal under $5M TDV; often CFO-approvable without full board process. BOARD VOTE LIKELY — TDV over $5M; board approval is commonly required. K_eff — Efficiency factor used for TDV sizing. In normal yield conditions, K_eff ≈ 0.567 (= 90% invested principal × 63% student payout). In low-yield zones, the payout stack can shift (fee sacrifice/waiver), and K_eff adjusts accordingly. 9 months — Academic year assumption (Sept–May) used for token math. $25 token — Token unit value when redeemed (USD)."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetDraft}
              className="rounded border border-accent bg-muted px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/60"
            >
              RESET INPUTS
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Inputs */}
          <section className="flex flex-col lg:col-span-7">
            <div className="rounded-2xl border border-accent bg-muted p-6">
              <div className="mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inputs</h2>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor="deal-university-name"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Institution Name
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
                    Recommended: 20% (based on 80/20 rule)
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
                    Recommended: 1.0 tokens / student / month
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
                    Current BENJI Yield Rate: 3.60%
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-accent/40 bg-background/20 p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Scenario metadata
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="scenario-tags"
                      className="mb-1 block text-xs text-muted-foreground"
                    >
                      Tags
                    </label>
                    <input
                      id="scenario-tags"
                      name="scenarioTags"
                      value={scenarioTagsInput}
                      onChange={(e) => setScenarioTagsInput(e.target.value)}
                      placeholder="e.g., board-vote, pilot, salvageable"
                      className="h-10 w-full rounded border border-accent bg-background/50 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <div className="mt-1 text-xs text-muted-foreground/80">
                      Comma-separated. Saved with the scenario record.
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label
                      htmlFor="scenario-notes"
                      className="mb-1 block text-xs text-muted-foreground"
                    >
                      Notes
                    </label>
                    <textarea
                      id="scenario-notes"
                      name="scenarioNotes"
                      value={scenarioNotes}
                      onChange={(e) => setScenarioNotes(e.target.value)}
                      placeholder="Optional context for future you (why we saved this, next steps, objections, etc.)"
                      className="min-h-[84px] w-full resize-y rounded border border-accent bg-background/50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
              </div>

              {saveError && (
                <p className="mt-4 text-sm text-destructive">{saveError}</p>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-accent/40 pt-6">
                {saved && (
                  <span className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-mono font-semibold text-success">
                    Saved to scenarios.
                  </span>
                )}
                <button
                  type="button"
                  onClick={saveScenario}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving..." : "Save Scenario"}
                </button>
              </div>
            </div>
            <div className="mt-4 flex-1 rounded-2xl border border-accent bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Deal Summary
              </div>
              <div className="text-foreground">
                {executiveSummary}
              </div>
            </div>
          </section>

          {/* Right: Sticky Deal Card */}
          <aside className="lg:col-span-5">
            <div className="lg:sticky lg:top-6">
              <div className="rounded-2xl border border-accent bg-muted p-6">
                <div className="mb-6">
                  <label
                    htmlFor="deal-card-scenario-name"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Scenario Name
                  </label>
                  <input
                    id="deal-card-scenario-name"
                    name="scenarioName"
                    type="text"
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                    placeholder="e.g., University of Texas at Austin - Initial Deal Review"
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
                    <div className="text-lg font-semibold">
                      {scenarioName.trim() || universityName.trim() || "Untitled Scenario"}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ZoneBadge zone={zone} />
                      {zone === "GREEN" && showFastTrack && (
                        <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                          <CheckCircle2 className="h-4 w-4" />
                          FAST TRACK
                          <span className="font-normal text-success/80">
                            (Likely CFO approval under $5M)
                          </span>
                        </span>
                      )}
                      {zone === "GREEN" && showBoardVoteWarning && (
                        <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
                          <AlertTriangle className="h-4 w-4" />
                          BOARD VOTE LIKELY
                          <span className="font-normal text-amber-200/80">
                            (TDV over $5M)
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4">
                  {/* Headline qualification */}
                  <MetricRow
                    label="Deal Score"
                    subtitle="1 = low priority. 100 = perfect fit."
                    value={`${dealScore.score}/100`}
                    valueClassName={dealScoreClass}
                  />
                  <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">Signal:</span>{" "}
                    <span className={dealScoreClass}>{dealScore.label}</span>
                    <InlineHelp
                      ariaLabel="Why this deal score?"
                      text={dealScoreExplanation}
                      heading="Why this score?"
                    />
                  </div>

                  {/* Economics (money lens) */}
                  <MetricRow
                    label="Total Deal Value (TDV)"
                    value={
                      computed.tdv != null ? currency0.format(computed.tdv) : "—"
                    }
                    valueClassName="text-blue-400"
                  />
                  <MetricRow
                    label={
                      <span className="inline-flex items-center">
                        Upfront Fee (10%)
                        <InlineHelp
                          ariaLabel="Explain upfront fee"
                          heading="Upfront fee model"
                          text="Modeled as 10% of TDV (one-time upfront fee). The engine assumes the remaining 90% of TDV is invested; Fee Recoup Period is the time for yield on that invested principal to cover the upfront fee."
                        />
                      </span>
                    }
                    value={
                      computed.upfrontFee != null ? currency0.format(computed.upfrontFee) : "—"
                    }
                    valueClassName="text-blue-400"
                  />
                  <MetricRow
                    label={
                      <span className="inline-flex items-center">
                        Projected ARR (Operator)
                        <InlineHelp
                          ariaLabel="Explain projected ARR"
                          heading="Projected ARR model"
                          text="Estimated annual operator revenue on invested principal (TDV × 90% × yield rate), multiplied by the operator share. In low-yield environments, the operator share may be reduced or waived per the OYE operating zones."
                        />
                      </span>
                    }
                    value={
                      computed.projectedArr != null ? currency0.format(computed.projectedArr) : "—"
                    }
                    valueClassName="text-amber-400"
                  />
                  <MetricRow
                    label="Annual Reward Dollars to Students"
                    value={
                      computed.annualPayout != null
                        ? currency0.format(computed.annualPayout)
                        : "—"
                    }
                    valueClassName="text-success"
                  />

                  {/* Scale / participation */}
                  <MetricRow
                    label="Students Expected to Participate"
                    value={
                      computed.activeStudents != null
                        ? number0.format(computed.activeStudents)
                        : "—"
                    }
                    valueClassName="text-blue-400"
                  />
                  <MetricRow
                    label={
                      <span className="inline-flex items-center">
                        Endowment Per Student (EPS)
                        <InlineHelp
                          ariaLabel="Explain Endowment Per Student (EPS)"
                          text="This is the school’s total reported endowment divided by total enrollment (Endowment ÷ Students). It is not the project principal; we use it as a proxy for institutional affordability."
                        />
                      </span>
                    }
                    value={computed.eps != null ? currency0.format(computed.eps) : "—"}
                    valueClassName="text-blue-400"
                  />

                  {/* Risk / pressure */}
                  <MetricRow
                    label="Allocation % (TDV / Endowment)"
                    value={
                      computed.allocation != null ? percent2.format(computed.allocation) : "—"
                    }
                    valueClassName="text-blue-400"
                  />
                  <MetricRow
                    label="Fee Recoup Period"
                    subtitle="Time until risk-free yield covers the 10% upfront fee."
                    value={
                      computed.feeRecoupYears != null
                        ? `${computed.feeRecoupYears.toFixed(2)} Years`
                        : "—"
                    }
                    valueClassName={feeRecoupIsLong ? "text-destructive" : "text-blue-400"}
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

              </div>
            </div>
          </aside>
        </div>

        {/* Load Scenarios */}
        <section className="mt-10 rounded-2xl border border-accent bg-muted p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved Scenarios</h2>
              <p className="text-sm text-muted-foreground">
                View or manage saved scenarios.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, institution, tags, id…"
                className="h-9 w-72 max-w-full rounded border border-accent bg-background/50 px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
              />
              <label className="inline-flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="h-4 w-4 rounded border-accent"
                />
                Show archived
              </label>
              <label className="inline-flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showDeleted}
                  onChange={(e) => setShowDeleted(e.target.checked)}
                  className="h-4 w-4 rounded border-accent"
                />
                Show deleted
              </label>

              <button
                type="button"
                onClick={archiveSelectedScenarios}
                disabled={deletingScenarios || selectedVisibleIds.size === 0}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-mono text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {deletingScenarios ? "ARCHIVING..." : "ARCHIVE SELECTED"}
              </button>
              <button
                type="button"
                onClick={deleteSelectedScenarios}
                disabled={deletingScenarios || selectedVisibleIds.size === 0}
                className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-mono text-destructive hover:bg-destructive/20 disabled:opacity-50"
              >
                {deletingScenarios ? "DELETING..." : "SOFT DELETE"}
              </button>
              {showDeleted && (
                <button
                  type="button"
                  onClick={restoreSelectedScenarios}
                  disabled={deletingScenarios || selectedVisibleIds.size === 0}
                  className="rounded border border-success/40 bg-success/10 px-3 py-2 text-xs font-mono text-success hover:bg-success/20 disabled:opacity-50"
                >
                  {deletingScenarios ? "RESTORING..." : "RESTORE SELECTED"}
                </button>
              )}
              {showArchived && (
                <button
                  type="button"
                  onClick={unarchiveSelectedScenarios}
                  disabled={deletingScenarios || selectedVisibleIds.size === 0}
                  className="rounded border border-success/40 bg-success/10 px-3 py-2 text-xs font-mono text-success hover:bg-success/20 disabled:opacity-50"
                >
                  {deletingScenarios ? "UNARCHIVING..." : "UNARCHIVE SELECTED"}
                </button>
              )}
              <button
                type="button"
                onClick={loadScenarios}
                disabled={loadingScenarios}
                className="rounded border border-accent bg-muted px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/60 disabled:opacity-50"
              >
                {loadingScenarios ? "REFRESHING..." : "REFRESH DATABASE"}
              </button>
            </div>
          </div>

          {loadError && <p className="mb-2 text-sm text-destructive">{loadError}</p>}
          {deleteError && <p className="mb-2 text-sm text-destructive">{deleteError}</p>}
          {pinError && <p className="mb-4 text-sm text-destructive">{pinError}</p>}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/60 bg-background/20 px-4 py-3">
            <div className="text-xs text-muted-foreground">
              {scenarioTotal > 0 ? (
                <>
                  Showing{" "}
                  <span className="font-mono text-foreground">
                    {scenarioShowingFrom}–{scenarioShowingTo}
                  </span>{" "}
                  of <span className="font-mono text-foreground">{scenarioTotal}</span>
                </>
              ) : (
                <>0 scenarios</>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded border border-accent bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                Rows
                <select
                  value={scenarioPageSize}
                  onChange={(e) => setScenarioPageSize(Number(e.target.value) || 50)}
                  className="h-7 rounded border border-accent bg-background/60 px-2 font-mono text-xs text-foreground outline-none"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setScenarioPage((p) => Math.max(1, p - 1))}
                disabled={loadingScenarios || scenarioPage <= 1}
                className="rounded border border-accent bg-background px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/80 disabled:opacity-50"
              >
                PREV
              </button>
              <div className="rounded border border-accent bg-background/40 px-3 py-2 text-xs font-mono text-muted-foreground">
                Page <span className="text-foreground">{scenarioPage}</span> /{" "}
                <span className="text-foreground">{scenarioPageCount}</span>
              </div>
              <button
                type="button"
                onClick={() => setScenarioPage((p) => Math.min(scenarioPageCount, p + 1))}
                disabled={loadingScenarios || scenarioPage >= scenarioPageCount}
                className="rounded border border-accent bg-background px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/80 disabled:opacity-50"
              >
                NEXT
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-accent/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-background/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all scenarios"
                      checked={
                        visibleScenarios.length > 0 &&
                        selectedVisibleIds.size > 0 &&
                        selectedVisibleIds.size === visibleScenarios.length
                      }
                      onChange={(e) => toggleAllScenarios(e.target.checked)}
                      className="h-4 w-4 rounded border-accent"
                    />
                  </th>
                  <th className="px-4 py-3">University</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">TDV</th>
                  <th className="px-4 py-3">Upfront Fee</th>
                  <th className="px-4 py-3">Projected ARR</th>
                  <th className="px-4 py-3">Allocation</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-accent/40">
                {visibleScenarios.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-sm text-muted-foreground">
                      {loadingScenarios ? "Loading..." : "No matching scenarios."}
                    </td>
                  </tr>
                ) : (
                  visibleScenarios.map((s) => {
                    const E = safeNumber(s.endowment_size);
                    const T = safeNumber(s.student_enrollment);
                    const tdv = safeNumber(s.calculated_tdv);
                    const alloc =
                      tdv != null && E != null && E > 0 ? tdv / E : null;
                    const feeRecoupYears =
                      s.interest_rate != null && s.interest_rate > 0
                        ? 1 / (ACADEMIC_MONTHS * (s.interest_rate / 100))
                        : null;
                    const eps =
                      E != null && T != null && T > 0 ? E / T : null;
                    const savedScore =
                      eps != null && alloc != null && feeRecoupYears != null && tdv != null && E != null
                        ? computeDealScore({
                            zone: s.deal_zone ?? null,
                            eps,
                            allocation: alloc,
                            feeRecoupYears,
                            tdv,
                            endowment: E,
                            canCompute: true,
                          }).score
                        : null;
                    // Use saved upfront fee and projected ARR, with fallback to calculation for older records
                    const upfrontFee = s.upfront_fee != null ? s.upfront_fee : (tdv != null ? tdv * 0.1 : null);
                    const projectedArr = s.projected_arr != null ? s.projected_arr : (() => {
                      const investedPrincipal = tdv != null ? tdv * 0.9 : null;
                      const interestRateDecimal = s.interest_rate != null ? s.interest_rate / 100 : null;
                      const annualYield = investedPrincipal != null && interestRateDecimal != null ? investedPrincipal * interestRateDecimal : null;
                      const yieldRatePercent = s.interest_rate ?? null;
                      const shares = getYieldWaterfallShares(yieldRatePercent);
                      return annualYield != null ? annualYield * shares.operatorShare : null;
                    })();
                    return (
                      <tr key={s.id} className="hover:bg-background/40">
                        <td className="px-4 py-3 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Select scenario ${s.name || s.university_name || s.id}`}
                            checked={selectedScenarioIds.has(s.id)}
                            onChange={() => toggleScenarioSelection(s.id)}
                            className="h-4 w-4 rounded border-accent"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold">
                            <span className="inline-flex items-center gap-2">
                              {s.pinned && (
                                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                                  PINNED
                                </span>
                              )}
                              {s.name || s.university_name || "—"}
                            </span>
                          </div>
                          {s.name && s.university_name && (
                            <div className="text-xs text-muted-foreground">
                              {s.university_name}
                            </div>
                          )}
                          {(s.version != null || s.scenario_group_id != null) && (
                            <div className="text-xs text-muted-foreground">
                              {s.version != null ? (
                                <span className="font-mono">v{s.version}</span>
                              ) : (
                                <span className="font-mono">v—</span>
                              )}
                              {s.scenario_group_id ? (
                                <span className="ml-2 font-mono text-muted-foreground/80">
                                  group: {String(s.scenario_group_id).slice(0, 8)}…
                                </span>
                              ) : null}
                            </div>
                          )}
                          <div className="text-xs font-mono text-muted-foreground">
                            id: {s.id.slice(0, 8)}…
                          </div>
                          {s.tags && s.tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {s.tags.slice(0, 4).map((t) => (
                                <span
                                  key={t}
                                  className="rounded bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground"
                                >
                                  {t}
                                </span>
                              ))}
                              {s.tags.length > 4 && (
                                <span className="rounded bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                                  +{s.tags.length - 4}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <ZonePill zone={s.deal_zone ?? null} />
                        </td>
                        <td className="px-4 py-3 align-top font-mono">
                          {s.deal_score != null
                            ? `${Math.round(s.deal_score)}/100`
                            : savedScore != null
                              ? `${savedScore}/100`
                              : "—"}
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-blue-400">
                          {tdv != null ? currency0.format(tdv) : "—"}
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-blue-400">
                          {upfrontFee != null ? currency0.format(upfrontFee) : "—"}
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-blue-400">
                          {projectedArr != null ? currency0.format(projectedArr) : "—"}
                        </td>
                        <td className="px-4 py-3 align-top font-mono">
                          {alloc != null ? percent2.format(alloc) : "—"}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => togglePinnedScenario(s)}
                              className="rounded border border-accent bg-background px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-background/80"
                              aria-label={s.pinned ? "Unpin scenario" : "Pin scenario"}
                              title={s.pinned ? "Unpin" : "Pin"}
                            >
                              {s.pinned ? "★" : "☆"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                markScenarioViewed(s);
                                setCompareOpen(false);
                                setPreviewScenario(s);
                              }}
                              className="rounded border border-accent bg-background px-3 py-1 text-xs font-mono text-muted-foreground hover:bg-background/80"
                            >
                              VIEW
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
        {previewScenario && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
            <div className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-accent bg-muted shadow-2xl">
              {/* Header: Title | Close */}
              <div className="flex items-center gap-4 border-b border-accent/40 p-6">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono text-muted-foreground">
                    SAVED SCENARIO
                  </div>
                  <h3 className="mt-1 truncate text-lg font-semibold">
                    {previewScenario.name || previewScenario.university_name || "Untitled"}
                  </h3>
                  {previewScenario.university_name && (
                    <p className="truncate text-xs text-muted-foreground">
                      Institution: {previewScenario.university_name}
                    </p>
                  )}
                  <p className="mt-1 truncate text-xs font-mono text-muted-foreground">
                    id: {previewScenario.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCompareOpen(false);
                    setPreviewScenario(null);
                  }}
                  className="shrink-0 rounded-full border border-accent bg-background px-3 py-1 text-xs font-mono text-muted-foreground hover:bg-background/80"
                >
                  CLOSE
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* Two-column layout for main content */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
                  {/* Left Column: Inputs and Score Explanation */}
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Deal inputs
                      </div>
                      <div className="grid grid-cols-2 gap-4 rounded-xl border border-accent/50 bg-background/30 p-4 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Endowment Size</div>
                        <div className="font-mono">
                          {previewScenario.endowment_size != null
                            ? currency0.format(previewScenario.endowment_size)
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Enrollment</div>
                        <div className="font-mono">
                          {previewScenario.student_enrollment != null
                            ? number0.format(previewScenario.student_enrollment)
                            : "—"}{" "}
                          students
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Target Reach</div>
                        <div className="font-mono">
                          {previewScenario.target_reach_percent != null
                            ? `${previewScenario.target_reach_percent}%`
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Engagement / Redemption Velocity
                        </div>
                        <div className="font-mono">
                          {previewScenario.redemption_velocity != null
                            ? `${previewScenario.redemption_velocity} tokens / student / month`
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Yield Rate</div>
                        <div className="font-mono">
                          {previewScenario.interest_rate != null
                            ? `${previewScenario.interest_rate}%`
                            : "—"}
                        </div>
                      </div>
                      {previewScenario.created_at && (
                        <div>
                          <div className="text-xs text-muted-foreground">Created</div>
                          <div className="font-mono">
                            {new Date(previewScenario.created_at).toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                    </div>

                    {previewScenario.score_explanation && (
                      <div className="rounded-xl border border-accent/50 bg-background/30 p-4 text-sm">
                        <div className="mb-2 text-xs font-semibold text-muted-foreground">Why this score?</div>
                        <p className="leading-relaxed text-muted-foreground">
                          {previewScenario.score_explanation}
                        </p>
                      </div>
                    )}

                    {/* Key KPIs (persisted + derived): 2 rows of 3 */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-accent/50 bg-background/30 p-3">
                        <div className="text-xs text-muted-foreground">TDV</div>
                        <div className="mt-1 font-mono font-semibold text-blue-400">
                          {previewDerived?.tdv != null ? currency0.format(previewDerived.tdv) : "—"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-accent/50 bg-background/30 p-3">
                        <div className="text-xs text-muted-foreground">Upfront Fee (10%)</div>
                        <div className="mt-1 font-mono font-semibold text-blue-400">
                          {previewDerived?.upfrontFee != null
                            ? currency0.format(previewDerived.upfrontFee)
                            : "—"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-accent/50 bg-background/30 p-3">
                        <div className="text-xs text-muted-foreground">Projected ARR (Operator)</div>
                        <div className="mt-1 font-mono font-semibold text-amber-400">
                          {previewDerived?.projectedArr != null
                            ? currency0.format(previewDerived.projectedArr)
                            : "—"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-accent/50 bg-background/30 p-3">
                        <div className="text-xs text-muted-foreground">Allocation</div>
                        <div className="mt-1 font-mono font-semibold text-emerald-400">
                          {previewDerived?.alloc != null ? percent2.format(previewDerived.alloc) : "—"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-accent/50 bg-background/30 p-3">
                        <div className="text-xs text-muted-foreground">Students (Target)</div>
                        <div className="mt-1 font-mono font-semibold text-blue-400">
                          {previewScenario.target_students != null
                            ? number0.format(previewScenario.target_students)
                            : "—"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-accent/50 bg-background/30 p-3">
                        <div className="text-xs text-muted-foreground">Fee Recoup Period</div>
                        <div
                          className={[
                            "mt-1 font-mono font-semibold",
                            previewDerived?.feeRecoupIsLong ? "text-destructive" : "text-blue-400",
                          ].join(" ")}
                        >
                          {previewDerived?.feeRecoupYears != null
                            ? `${previewDerived.feeRecoupYears.toFixed(2)} Years`
                            : "—"}
                        </div>
                      </div>
                    </div>

                    {(previewScenario.tags && previewScenario.tags.length > 0) ||
                    (previewScenario.notes && previewScenario.notes.trim()) ? (
                      <div className="rounded-xl border border-accent/50 bg-background/30 p-4 text-sm">
                        <div className="mb-2 text-xs font-semibold text-muted-foreground">
                          Scenario metadata
                        </div>
                        {previewScenario.tags && previewScenario.tags.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1">
                            {previewScenario.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {previewScenario.notes && previewScenario.notes.trim() && (
                          <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                            {previewScenario.notes.trim()}
                          </p>
                        )}
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between">
                      <div className="text-xs font-mono text-muted-foreground">
                        Compare saved scenario to current draft (read-only)
                      </div>
                      <button
                        type="button"
                        onClick={() => setCompareOpen((o) => !o)}
                        className="rounded border border-accent bg-background px-3 py-1 text-xs font-mono text-muted-foreground hover:bg-background/80"
                      >
                        {compareOpen ? "HIDE COMPARE" : "COMPARE"}
                      </button>
                    </div>

                    {compareOpen && (
                      <div className="rounded-xl border border-accent/50 bg-background/30 p-4 text-sm">
                        <div className="mb-2 text-xs font-semibold text-muted-foreground">
                          Delta vs current draft (Saved − Draft)
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {(() => {
                            const draftTdv = computed.tdv;
                            const draftUpfront = computed.upfrontFee;
                            const draftArr = computed.projectedArr;
                            const draftAlloc = computed.allocation;
                            const draftStudents = computed.activeStudents;
                            const draftRecoup = computed.feeRecoupYears;
                            const draftScore = dealScore?.score ?? null;

                            const fmtDeltaMoney = (saved: number | null, draft: number | null) => {
                              if (saved == null || draft == null) return "—";
                              const d = saved - draft;
                              const sign = d > 0 ? "+" : "";
                              return `${sign}${currency0.format(d)}`;
                            };
                            const fmtDeltaPct = (saved: number | null, draft: number | null) => {
                              if (saved == null || draft == null) return "—";
                              const d = saved - draft;
                              const sign = d > 0 ? "+" : "";
                              return `${sign}${percent2.format(d)}`;
                            };
                            const fmtDeltaNum = (saved: number | null, draft: number | null) => {
                              if (saved == null || draft == null) return "—";
                              const d = saved - draft;
                              const sign = d > 0 ? "+" : "";
                              return `${sign}${number0.format(d)}`;
                            };
                            const fmtDeltaYears = (saved: number | null, draft: number | null) => {
                              if (saved == null || draft == null) return "—";
                              const d = saved - draft;
                              const sign = d > 0 ? "+" : "";
                              return `${sign}${d.toFixed(2)} yrs`;
                            };

                            return (
                              <>
                                <div className="rounded-lg border border-accent/40 bg-background/20 p-3">
                                  <div className="text-xs text-muted-foreground">Deal Score</div>
                                  <div className={["mt-1 font-mono font-semibold", previewDerived?.dealScoreClass ?? ""].join(" ")}>
                                    {previewDerived?.dealScore?.score != null && draftScore != null
                                      ? `${previewDerived.dealScore.score - draftScore >= 0 ? "+" : ""}${previewDerived.dealScore.score - draftScore} pts`
                                      : "—"}
                                  </div>
                                </div>

                                <div className="rounded-lg border border-accent/40 bg-background/20 p-3">
                                  <div className="text-xs text-muted-foreground">TDV</div>
                                  <div className="mt-1 font-mono font-semibold text-blue-400">
                                    {fmtDeltaMoney(previewDerived?.tdv ?? null, draftTdv ?? null)}
                                  </div>
                                </div>

                                <div className="rounded-lg border border-accent/40 bg-background/20 p-3">
                                  <div className="text-xs text-muted-foreground">Upfront Fee</div>
                                  <div className="mt-1 font-mono font-semibold text-blue-400">
                                    {fmtDeltaMoney(previewDerived?.upfrontFee ?? null, draftUpfront ?? null)}
                                  </div>
                                </div>

                                <div className="rounded-lg border border-accent/40 bg-background/20 p-3">
                                  <div className="text-xs text-muted-foreground">Projected ARR</div>
                                  <div className="mt-1 font-mono font-semibold text-amber-400">
                                    {fmtDeltaMoney(previewDerived?.projectedArr ?? null, draftArr ?? null)}
                                  </div>
                                </div>

                                <div className="rounded-lg border border-accent/40 bg-background/20 p-3">
                                  <div className="text-xs text-muted-foreground">Allocation</div>
                                  <div className="mt-1 font-mono font-semibold text-emerald-400">
                                    {fmtDeltaPct(previewDerived?.alloc ?? null, draftAlloc ?? null)}
                                  </div>
                                </div>

                                <div className="rounded-lg border border-accent/40 bg-background/20 p-3">
                                  <div className="text-xs text-muted-foreground">Students (Target)</div>
                                  <div className="mt-1 font-mono font-semibold text-blue-400">
                                    {fmtDeltaNum(
                                      previewScenario.target_students ?? null,
                                      draftStudents ?? null
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-lg border border-accent/40 bg-background/20 p-3 sm:col-span-2">
                                  <div className="text-xs text-muted-foreground">Fee Recoup Period</div>
                                  <div className="mt-1 font-mono font-semibold text-blue-400">
                                    {fmtDeltaYears(previewDerived?.feeRecoupYears ?? null, draftRecoup ?? null)}
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Deal Summary */}
                  <div className="lg:min-h-0">
                    {previewScenario.deal_summary && (
                      <div className="rounded-xl border border-accent bg-muted p-4 text-sm leading-relaxed">
                        <div className="mb-3 text-sm text-muted-foreground">
                          The Offbeat Yield Engine (OYE) classifies this opportunity as{" "}
                          <span className="font-semibold">{previewDerived?.zoneStatus ?? "—"}</span>{" "}
                          with a Deal Score of{" "}
                          <span className={["font-semibold", previewDerived?.dealScoreClass ?? ""].join(" ")}>
                            {previewDerived?.dealScore?.score != null
                              ? `${previewDerived.dealScore.score}/100`
                              : "—"}
                          </span>
                          . This deal is{" "}
                          <span className={["font-semibold", previewDerived?.dealScoreClass ?? ""].join(" ")}>
                            {previewDerived?.dealScore?.label != null
                              ? previewDerived.dealScore.label.toLowerCase()
                              : "—"}
                          </span>
                          .
                        </div>

                        <div className="space-y-3 text-foreground">
                          {(previewScenario.deal_summary as string)
                            .split(/\n\n+/)
                            .filter((p) => p.trim())
                            .map((paragraph, i) => (
                              <p key={i}>
                                {paragraph.trim()}
                              </p>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-accent/40 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      loadScenario(previewScenario);
                      setCompareOpen(false);
                      setPreviewScenario(null);
                    }}
                    className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    Load into Deal Desk
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      duplicateScenarioIntoDraft(previewScenario);
                      setCompareOpen(false);
                      setPreviewScenario(null);
                    }}
                    className="inline-flex items-center gap-2 rounded border border-accent bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-background/80"
                  >
                    Duplicate into Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePinnedScenario(previewScenario)}
                    className="inline-flex items-center gap-2 rounded border border-accent bg-background px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-background/80"
                  >
                    {previewScenario.pinned ? "★ PINNED" : "☆ PIN"}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleScenarioSelection(previewScenario.id)}
                    className="text-xs font-mono text-destructive underline-offset-2 hover:underline"
                  >
                    {selectedScenarioIds.has(previewScenario.id)
                      ? "Unselect for actions"
                      : "Mark for archive/delete"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
        PURSUE
      </span>
    );
  }
  if (zone === "ORANGE") {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-400">
        CONSIDER
      </span>
    );
  }
  if (zone === "RED") {
    return (
      <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
        NOT FIT
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-accent/30 bg-background/40 px-2 py-1 text-xs font-semibold text-muted-foreground">
      —
    </span>
  );
}

function InlineHelp({
  text,
  ariaLabel,
  heading = "What does this mean?",
}: {
  text: string;
  ariaLabel: string;
  heading?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-accent/60 bg-background text-[10px] leading-none text-muted-foreground hover:bg-background/80 focus:outline-none focus:ring-2 focus:ring-primary/30"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 bottom-full z-50 mb-1 w-80 max-w-[90vw] rounded-lg border border-accent bg-muted p-3 text-left text-xs text-foreground shadow-lg"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <span className="mb-1 block font-semibold text-muted-foreground">{heading}</span>
          <span className="block leading-relaxed">{text}</span>
        </span>
      )}
    </span>
  );
}

function MetricRow({
  label,
  subtitle,
  value,
  valueClassName,
}: {
  label: ReactNode;
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

