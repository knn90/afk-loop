export const evidenceFolder = "~/afk-evidence";
export const videoCapMb = 10;

type Outcome = "PASS" | "FAIL" | "INCONCLUSIVE";
type Kind = "criterion" | "regression";
type Result = "met" | "not met" | "unchecked";

export interface Claim {
  readonly kind: Kind;
  readonly criterion: string;
  readonly result: Result;
  readonly observed: string;
  readonly screenshots: readonly string[];
  readonly feature: string | null;
}

export interface Skipped {
  readonly kind: Kind;
  readonly criterion: string;
  readonly why: string;
  readonly feature?: string;
}

export interface Manifest {
  readonly outcome: Outcome;
  readonly head: string;
  readonly reason?: string;
  readonly claims: readonly Claim[];
  readonly skipped: readonly Skipped[];
  readonly video?: string;
}
