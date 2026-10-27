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

export interface EvidenceFile {
  readonly name: string;
  readonly bytes: number;
}

export interface BehaviorReading {
  readonly outcome: Outcome;
  readonly reason?: string;
  readonly claims: readonly Claim[];
  readonly skipped: readonly Skipped[];
  readonly video?: string;
}

export interface BehaviorCheck extends BehaviorReading {
  readonly head: string;
  readonly verifySkill: string;
  readonly log: string;
  readonly evidence: string;
}

export const noBehaviorCheck = "No Behavior check: the branch changes no Platform with a Verify skill.";

export function inconclusive(reason: string): BehaviorReading {
  return { outcome: "INCONCLUSIVE", reason, claims: [], skipped: [] };
}

export function hostReads(raw: string | undefined, finalHead: string, files: readonly EvidenceFile[]): BehaviorReading {
  if (raw === undefined) return inconclusive("no Evidence manifest");
  const manifest = parsed(raw);
  if (!manifest) return inconclusive("Evidence manifest unreadable");
  if (manifest.head !== finalHead) return inconclusive(`Evidence manifest is for ${manifest.head.slice(0, 7)}, not ${finalHead.slice(0, 7)}`);
  const listed = [...new Set([...manifest.claims.flatMap((claim) => claim.screenshots), ...(manifest.video ? [manifest.video] : [])])];
  const missing = listed.find((file) => !files.some(({ name }) => name === file) || file.includes("/"));
  if (missing) return inconclusive(`listed file ${missing} not in ${evidenceFolder}`);
  const derived = manifest.claims.some((claim) => claim.result === "not met")
    ? "FAIL"
    : manifest.claims.length === 0 || manifest.claims.some((claim) => claim.result === "unchecked" || claim.screenshots.length === 0)
      ? "INCONCLUSIVE"
      : "PASS";
  const { outcome, reason, claims, skipped, video } = manifest;
  const shown = { claims, skipped, ...(video ? { video } : {}) };
  if (derived !== outcome) return { outcome: "INCONCLUSIVE", reason: `Evidence manifest says ${outcome}, its claims say ${derived}`, ...shown };
  return { outcome, ...(reason ? { reason } : {}), ...shown };
}

const outcomes: readonly unknown[] = ["PASS", "FAIL", "INCONCLUSIVE"];
const kinds: readonly unknown[] = ["criterion", "regression"];
const results: readonly unknown[] = ["met", "not met", "unchecked"];

function parsed(raw: string): Manifest | undefined {
  try {
    const manifest: unknown = JSON.parse(raw);
    return isManifest(manifest) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isText = (value: unknown): value is string => typeof value === "string";
const isOptionalText = (value: unknown) => value === undefined || isText(value);
const isList = <T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] => Array.isArray(value) && value.every(isItem);

function isClaim(value: unknown): value is Claim {
  return (
    isObject(value) &&
    kinds.includes(value.kind) &&
    isText(value.criterion) &&
    results.includes(value.result) &&
    isText(value.observed) &&
    isList(value.screenshots, isText) &&
    (value.feature === null || isText(value.feature))
  );
}

function isSkipped(value: unknown): value is Skipped {
  return isObject(value) && kinds.includes(value.kind) && isText(value.criterion) && isText(value.why) && isOptionalText(value.feature);
}

function isManifest(value: unknown): value is Manifest {
  return (
    isObject(value) &&
    outcomes.includes(value.outcome) &&
    isText(value.head) &&
    isOptionalText(value.reason) &&
    isList(value.claims, isClaim) &&
    isList(value.skipped, isSkipped) &&
    isOptionalText(value.video)
  );
}

const label = { met: "Met", "not met": "Not met", unchecked: "Unchecked" } as const;

function sentence(text: string): string {
  return text.replace(/[.\s]+$/, "");
}

export function behaviorSection({ outcome, reason, claims, skipped, video, head, verifySkill, log, evidence }: BehaviorCheck): string {
  const why = [outcome === "PASS" ? undefined : reason && sentence(reason), outcome === "INCONCLUSIVE" ? "Check the app by hand before merging" : undefined].filter(Boolean).join(". ");
  const claimLines = claims.map((claim) => {
    const tag = claim.kind === "regression" ? `, regression (\`${claim.feature}\`)` : claim.feature === null ? ", no feature file, driven with the Drive commands" : "";
    return `- **${label[claim.result]}**${tag}: ${claim.criterion}\n  ${claim.observed}${claim.screenshots.map((file) => `\n  \`${file}\``).join("")}`;
  });
  const skippedLines = skipped.map((item) => `- ${sentence(item.criterion)}${item.feature ? ` (\`${item.feature}\`)` : ""}: ${item.why}.`);
  return [
    `Behavior check: ${outcome} on \`${head.slice(0, 7)}\`${why ? `: ${why}` : ""}, by the AFK loop's Verifier in the Sandbox with \`${verifySkill}\`. Its log on the Host: \`${log}\`. Its Behavior evidence on the Host: \`${evidence}\`.`,
    ...(claimLines.length ? [claimLines.join("\n")] : []),
    ...(skippedLines.length ? [`Not checked:\n${skippedLines.join("\n")}`] : []),
    ...(video ? [`Video of the drive: \`${video}\``] : []),
  ].join("\n\n");
}
