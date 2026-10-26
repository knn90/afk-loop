// PROTOTYPE, throwaway: answers "What does the Verifier's prompt say, and what is the Evidence manifest format?" (knn90/afk-loop#37).
// Run: npx tsx loop/verifier-prompt.prototype.ts

import type { Issue } from "./afk-loop.js";
import { completionSignal, glossaryRule, issueBlock } from "./prompt-parts.js";

const evidenceFolder = "~/afk-evidence";
const videoCapMb = 10;

interface VerifierBrief {
  readonly repo: string;
  readonly issue: Issue;
  readonly branch: string;
  readonly base: string;
  readonly head: string;
  readonly verifySkill: string;
}

export function verifierPrompt({ repo, issue, branch, base, head, verifySkill }: VerifierBrief): string {
  return `You are the Verifier for issue #${issue.number} of ${repo}, on branch \`${branch}\` at commit \`${head}\`. The branch passed the Test run and the Reviewer's review. Your run is the Behavior check: drive the running app and report whether it does what the issue's Acceptance criteria say.

${issueBlock(issue)}

How to work:

- The Host restored the \`${verifySkill}\` skill from \`${base}\` before your run, so it may differ from the branch's copy. Use it as it is.
- You change no tracked file and commit nothing; you may write outside the repo. After your run the Host checks HEAD is \`${head}\` and \`git status\` is clean; if not, the Behavior check is INCONCLUSIVE whatever you report.
- ${glossaryRule}
- Read the branch diff, \`git diff ${base}...HEAD\`, to see what changed.
- Choose the criteria to check: every item under \`## Acceptance criteria\`, and under \`## Manual check\` if the issue has one, that can be seen in the running app. Every other item is skipped as "not observable in the app".
- Also check regressions: for each feature the diff touches that has a feature file, drive that file's journeys. Each journey is a criterion to check, named as the file names it.
- Where a criterion from the issue and a journey disagree, the criterion holds: skip the journey as "changed by this issue: feature file out of date".
- Invoke the \`${verifySkill}\` skill with the Skill tool and read its feature map. For each criterion to check, find the feature file that covers it. With none, drive with the skill's Drive commands alone, taking every element name from the live accessibility tree. Never invent a path, element name or command.
- Before you drive: confirm, with the skill, that Launch, Doctor, a screenshot and a video recording each work.
- Drive the app through each criterion as its feature file says. For each, take at least one screenshot that shows the result. Record at most one video, at most ${videoCapMb} MB.
- The outcome:
  - FAIL: the app shows a checked criterion is not met, or the app crashes, at Launch or later. FAIL holds even if other criteria could not be checked.
  - INCONCLUSIVE: a step before driving does not work without the app crashing, or you could not reach or finish checking a criterion. Say the command you tried. Stop at the first such step.
  - PASS: every checked criterion is met, each with a screenshot.
  - With no criterion observable in the app, the outcome is INCONCLUSIVE.
- Evidence: copy the screenshots and video you choose into \`${evidenceFolder}/\`, flat, as \`.png\` and \`.mp4\`. The Host emptied it before your run. Then write \`${evidenceFolder}/manifest.json\`, the Evidence manifest, in this shape:

\`\`\`json
${JSON.stringify(manifestShape, null, 2)}
\`\`\`

  - \`head\` is \`git rev-parse HEAD\`.
  - \`reason\` says, in one sentence, why the outcome is FAIL or INCONCLUSIVE; leave it out on PASS.
  - Each checked criterion is one \`claims\` entry, its text quoted from the issue or the feature file. \`result\` is \`met\`, \`not met\` or \`unchecked\`. \`observed\` says what the app showed. \`feature\` is the feature file you followed, or \`null\` when you drove without one.
  - \`kind\` is \`criterion\` for an item from the issue and \`regression\` for a journey from a feature file.
  - Each skipped criterion is one \`skipped\` entry.
  - Only files the manifest lists reach the PR.
- This Sandbox is a macOS VM. The Host reads only the Evidence manifest and the files it lists, then puts them on the PR: this Sandbox has no GitHub access.

Done means \`${evidenceFolder}/manifest.json\` holds the outcome and every criterion is in \`claims\` or \`skipped\`. End your reply with ${completionSignal}.`;
}

type Result = "met" | "not met" | "unchecked";

type Kind = "criterion" | "regression";

interface Claim {
  readonly kind: Kind;
  readonly criterion: string;
  readonly result: Result;
  readonly observed: string;
  readonly screenshots: readonly string[];
  readonly feature: string | null;
}

interface Manifest {
  readonly outcome: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly head: string;
  readonly reason?: string;
  readonly claims: readonly Claim[];
  readonly skipped: readonly { readonly kind: Kind; readonly criterion: string; readonly why: string; readonly feature?: string }[];
  readonly video?: string;
}

const manifestShape: Manifest = {
  outcome: "PASS",
  head: "<full commit SHA>",
  reason: "<FAIL or INCONCLUSIVE only>",
  claims: [{ kind: "criterion", criterion: "<quoted from the issue>", result: "met", observed: "<what the app showed>", screenshots: ["<name>.png"], feature: "<feature file>.md or null" }],
  skipped: [{ kind: "regression", criterion: "<quoted from the issue or the feature file>", why: "not observable in the app" }],
  video: "<name>.mp4",
};

interface HostReading {
  readonly outcome: Manifest["outcome"];
  readonly reason?: string;
  readonly attach: readonly string[];
  readonly notes?: readonly string[];
}

function inconclusive(reason: string): HostReading {
  return { outcome: "INCONCLUSIVE", reason, attach: [] };
}

export function hostReads(raw: string | undefined, finalHead: string, files: readonly string[], videoMb: number): HostReading {
  if (raw === undefined) return inconclusive("no Evidence manifest");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return inconclusive("Evidence manifest unreadable");
  }
  if (manifest.head !== finalHead) return inconclusive(`Evidence manifest is for ${manifest.head.slice(0, 7)}, not ${finalHead.slice(0, 7)}`);
  const listed = [...manifest.claims.flatMap((claim) => claim.screenshots), ...(manifest.video ? [manifest.video] : [])];
  const missing = listed.find((file) => !files.includes(file) || file.includes("/"));
  if (missing) return inconclusive(`listed file ${missing} not in ${evidenceFolder}`);
  const derived = manifest.claims.some((claim) => claim.result === "not met")
    ? "FAIL"
    : manifest.claims.length === 0 || manifest.claims.some((claim) => claim.result === "unchecked" || claim.screenshots.length === 0)
      ? "INCONCLUSIVE"
      : "PASS";
  const attach = listed.filter((file) => file !== manifest.video || videoMb <= videoCapMb);
  const notes = manifest.claims.filter((claim) => claim.feature === null).map((claim) => `${claim.criterion}: no feature file; driven with the Drive commands`);
  if (derived !== manifest.outcome) return { outcome: "INCONCLUSIVE", reason: `Evidence manifest says ${manifest.outcome}, its claims say ${derived}`, attach, notes };
  return { outcome: manifest.outcome, ...(manifest.reason ? { reason: manifest.reason } : {}), attach, notes };
}

const head = "4f1c2a9e0b7d3c5a6e8f9012345678abcdef0123";

const sampleIssue: Issue = {
  number: 212,
  title: "iOS 14 · Add a Task from Today",
  labels: ["ready-for-agent"],
  openBlockers: 0,
  body: `## What to build

A + button on Today opens a sheet to name a new Task; saving adds it to today's list.

## Acceptance criteria

- [ ] Tapping + on Today opens the Add Task sheet with the name field focused
- [ ] Saving a non-empty name adds the Task to the bottom of today's list
- [ ] Save is disabled while the name is empty
- [ ] TaskStore.add has unit tests for empty and whitespace names

## Manual check

- Add "Drink water", kill and relaunch the app: the Task is still there`,
};

const samples: Record<string, { readonly manifest?: Manifest | string; readonly files: readonly string[]; readonly videoMb: number }> = {
  "PASS": {
    files: ["add-sheet-open.png", "task-added.png", "save-disabled.png", "check-off.png", "after-relaunch.png", "drive.mp4"],
    videoMb: 6.2,
    manifest: {
      outcome: "PASS",
      head,
      claims: [
        { kind: "criterion", criterion: "Tapping + on Today opens the Add Task sheet with the name field focused", result: "met", observed: "Sheet opened, keyboard up, cursor in Name.", screenshots: ["add-sheet-open.png"], feature: "add-task.md" },
        { kind: "criterion", criterion: "Saving a non-empty name adds the Task to the bottom of today's list", result: "met", observed: "\"Drink water\" appeared as the 4th and last row.", screenshots: ["task-added.png"], feature: "add-task.md" },
        { kind: "criterion", criterion: "Save is disabled while the name is empty", result: "met", observed: "Save greyed out with an empty field and with spaces only.", screenshots: ["save-disabled.png"], feature: null },
        { kind: "regression", criterion: "Today: check off Meditate, the progress reads All 1 marked", result: "met", observed: "Today's progress = All 1 marked.", screenshots: ["check-off.png"], feature: "today-check-off.md" },
        { kind: "criterion", criterion: "Add \"Drink water\", kill and relaunch the app: the Task is still there", result: "met", observed: "Row still present after relaunch.", screenshots: ["after-relaunch.png"], feature: "add-task.md" },
      ],
      skipped: [
        { kind: "criterion", criterion: "TaskStore.add has unit tests for empty and whitespace names", why: "not observable in the app" },
        { kind: "regression", criterion: "Today: new Task appears at the top of the list", why: "changed by this issue, feature file out of date", feature: "today-check-off.md" },
      ],
      video: "drive.mp4",
    },
  },
  "FAIL, video over cap": {
    files: ["add-sheet-open.png", "task-added-top.png", "drive.mp4"],
    videoMb: 14,
    manifest: {
      outcome: "FAIL",
      head,
      reason: "New Task lands at the top of today's list, not the bottom.",
      claims: [
        { kind: "criterion", criterion: "Tapping + on Today opens the Add Task sheet with the name field focused", result: "met", observed: "Sheet opened, keyboard up.", screenshots: ["add-sheet-open.png"], feature: "add-task.md" },
        { kind: "criterion", criterion: "Saving a non-empty name adds the Task to the bottom of today's list", result: "not met", observed: "\"Drink water\" appeared as the 1st row.", screenshots: ["task-added-top.png"], feature: "add-task.md" },
      ],
      skipped: [],
      video: "drive.mp4",
    },
  },
  "INCONCLUSIVE before drive": {
    files: [],
    videoMb: 0,
    manifest: { outcome: "INCONCLUSIVE", head, reason: "Doctor: app_running false after Launch (dq doctor exit 1).", claims: [], skipped: [] },
  },
  "PASS claimed, a claim unchecked": {
    files: ["add-sheet-open.png"],
    videoMb: 0,
    manifest: {
      outcome: "PASS",
      head,
      claims: [
        { kind: "criterion", criterion: "Tapping + on Today opens the Add Task sheet with the name field focused", result: "met", observed: "Sheet opened.", screenshots: ["add-sheet-open.png"], feature: "add-task.md" },
        { kind: "criterion", criterion: "Save is disabled while the name is empty", result: "unchecked", observed: "Save button not in the accessibility tree (dq tap \"Save\" timed out).", screenshots: [], feature: null },
      ],
      skipped: [],
    },
  },
  "stale head": { files: [], videoMb: 0, manifest: { outcome: "PASS", head: "0000000aaaa", claims: [], skipped: [] } },
  "no manifest": { files: [], videoMb: 0 },
};

function behaviorSection(manifest: Manifest, issue: number, verifySkill: string): string {
  const short = manifest.head.slice(0, 7);
  const label = { met: "Met", "not met": "Not met", unchecked: "Unchecked" } as const;
  const why = manifest.outcome === "PASS" ? "" : `: ${manifest.reason}${manifest.outcome === "INCONCLUSIVE" ? ". Check the app by hand before merging" : ""}`;
  const claims = manifest.claims.map((claim) => {
    const tag = claim.kind === "regression" ? `, regression (\`${claim.feature}\`)` : claim.feature === null ? ", no feature file, driven with the Drive commands" : "";
    return `- **${label[claim.result]}**${tag}: ${claim.criterion}\n  ${claim.observed}${claim.screenshots.map((file) => `\n  <${file}>`).join("")}`;
  });
  const skipped = manifest.skipped.map((item) => `- ${item.criterion}${item.feature ? ` (\`${item.feature}\`)` : ""}: ${item.why}.`);
  return [
    `Behavior check: ${manifest.outcome} on \`${short}\`${why}, by the AFK loop's Verifier in the Sandbox with \`${verifySkill}\`. Its log on the Host: \`.sandcastle/logs/issue-${issue}-verifier.log\`.`,
    claims.join("\n"),
    ...(skipped.length ? [`Not checked:\n${skipped.join("\n")}`] : []),
    ...(manifest.video ? [`Video of the drive: <${manifest.video}>`] : []),
  ].join("\n\n");
}

console.log("=".repeat(30), "VERIFIER PROMPT", "=".repeat(30));
console.log(verifierPrompt({ repo: "knn90/DailyQuest", issue: sampleIssue, branch: "afk/212-add-task", base: "main", head, verifySkill: "verify-dailyquest" }));
for (const [name, { manifest, files, videoMb }] of Object.entries(samples)) {
  const raw = typeof manifest === "string" || manifest === undefined ? manifest : JSON.stringify(manifest);
  console.log(`\n${"=".repeat(30)} HOST READS: ${name} ${"=".repeat(30)}`);
  console.log(JSON.stringify(hostReads(raw, head, files, videoMb), null, 2));
}
console.log(`\n${"=".repeat(30)} PR SECTION: PASS ${"=".repeat(30)}`);
console.log(behaviorSection(samples["PASS"]!.manifest as Manifest, 212, "verify-dailyquest"));
