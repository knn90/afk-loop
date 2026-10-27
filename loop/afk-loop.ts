import {
  attemptBudget,
  budgetSpentWhy,
  dirtyFeedback,
  fenced,
  handedOff,
  lastAttemptDetails,
  loopMarker,
  readyForAgent,
  readyForHuman,
  unchangedHeadFeedback,
} from "./loop-rules.js";
import { attachList, behaviorSection, hostReads, inconclusive, noBehaviorCheck, type BehaviorCheck, type EvidenceFile } from "./behavior-check.js";
import { linkedIssueNumbers } from "./linked-issues.js";
import { testChangedPlatforms, verifiedLine, type Platform } from "./platforms.js";

export interface Issue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly openBlockers: number;
  readonly comments?: readonly string[];
  readonly linkedIssues?: readonly LinkedIssue[];
}

export interface LinkedIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly comments: readonly string[];
}

export interface Backlog {
  readonly issues: readonly Issue[];
  readonly issuesWithOpenPullRequest: readonly number[];
  readonly pushedBranches: readonly string[];
}

export interface PullRequest {
  readonly branch: string;
  readonly title: string;
  readonly body: string;
  readonly attachments?: Attachments;
}

export interface Attachments {
  readonly files: readonly string[];
  unattached(ghError: string): string;
}

export interface OpenFinding {
  readonly text: string;
  readonly at?: { readonly path: string; readonly line?: number };
}

export interface PullRequestReview {
  readonly body: string;
  readonly comments: readonly { readonly path: string; readonly line: number; readonly body: string }[];
}

export interface Relabel {
  readonly remove: string;
  readonly add?: string;
}

export interface Tracker {
  backlog(): Promise<Backlog>;
  issueComments(issueNumber: number): Promise<string[]>;
  linkedIssues(numbers: readonly number[]): Promise<LinkedIssue[]>;
  pushBranch(branch: string): Promise<void>;
  openPullRequest(pullRequest: PullRequest): Promise<string>;
  postReview(pullRequest: string, review: PullRequestReview): Promise<void>;
  comment(issueNumber: number, body: string): Promise<void>;
  relabel(issueNumber: number, relabel: Relabel): Promise<void>;
}

export interface LocalBranch {
  readonly name: string;
  readonly leftover: boolean;
}

export interface WorktreeState {
  readonly dirty: boolean;
  readonly head: string;
  readonly commitsAhead: number;
  readonly platforms: readonly Platform[];
}

export interface CommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export type SandboxExec = (command: string, options?: { readonly cwd?: string; readonly timeoutMs?: number }) => Promise<CommandResult>;

export interface Session {
  readonly exec: SandboxExec;
  inspect(): Promise<WorktreeState>;
  close(): Promise<void>;
}

export interface IssueSession extends Session {
  implement(feedback?: string, fixableFindings?: string): Promise<ImplementerRun>;
  review(): Promise<FirstReview>;
  wrapUp(fixRound: FixRound): Promise<WrapUp>;
  verify(verifySkill: string, head: string): Promise<VerifierRun>;
  putBack(head: string): Promise<void>;
}

export interface VerifierRun {
  readonly log: string;
  readonly evidence: string;
  readonly manifest?: string;
  readonly files: readonly EvidenceFile[];
  readonly head: string;
  readonly dirty: boolean;
}

export interface ImplementerRun {
  readonly reply: string;
  readonly log: string;
  readonly findingsLeft?: string;
  readonly contradiction?: string;
}

export interface Review {
  readonly log: string;
  readonly openFindings: readonly OpenFinding[];
  readonly pullRequestDraft?: string;
}

export interface FirstReview extends Review {
  readonly fixableFindings?: string;
  readonly unreadable?: true;
}

export interface WrapUp {
  readonly log: string;
  readonly openFindings?: readonly OpenFinding[];
  readonly pullRequestDraft?: string;
}

export interface FixRound {
  readonly fixableFindings: string;
  readonly openFindings: readonly OpenFinding[];
  readonly reviewedHead: string;
  readonly findingsLeft?: string;
  readonly failed?: true;
}

export interface Agents {
  localBranches(issueNumber: number): Promise<LocalBranch[]>;
  discardLeftover(branch: string): Promise<void>;
  start(issue: Issue, branch: string): Promise<IssueSession>;
}

export interface TestRunner {
  run(sandbox: SandboxExec, branch: string, platforms: readonly Platform[]): Promise<{ passed: boolean; log: string }>;
  rawLogPath(branch: string): string;
}

export type SessionHandoff = {
  readonly issue: number;
  readonly kind: "handoff";
  readonly branch: string;
} & (
  | { readonly reason: "attempt-budget"; readonly log: string; readonly rawLog?: string }
  | { readonly reason: "no-commits"; readonly lastReply: string; readonly implementerLog: string }
  | { readonly reason: "contradiction"; readonly contradiction: string; readonly implementerLog: string }
);

export interface NoAcceptanceCriteria {
  readonly issue: number;
  readonly kind: "handoff";
  readonly reason: "no-acceptance-criteria";
  readonly missing: "section" | "items";
}

export type HandoffOutcome = SessionHandoff | NoAcceptanceCriteria;

export interface ReviewedOutcome {
  readonly issue: number;
  readonly kind: "pull-request";
  readonly branch: string;
  readonly reviewLogs: string[];
  readonly platforms: readonly Platform[];
  readonly openFindings: readonly OpenFinding[];
  readonly pullRequestDraft?: string;
  readonly fixRoundFailed?: true;
  readonly behaviorCheck?: BehaviorCheck;
}

export type Outcome =
  | ReviewedOutcome
  | HandoffOutcome
  | { readonly issue: number; readonly kind: "local-branch"; readonly branch: string }
  | { readonly issue: number; readonly kind: "error"; readonly message: string };

export interface AfkLoopOptions {
  readonly tracker: Tracker;
  readonly agents: Agents;
  readonly testRunner: TestRunner;
  readonly cap?: number;
  readonly platforms: readonly Platform[];
}

export const defaultCap = 5;
const priorities = ["priority:p0", "priority:p1", "priority:p2"];
const implementedBy = "Implemented by the AFK loop's Implementer in the Sandbox.";
const reviewedBy = "Reviewed by the AFK loop's Reviewer in the Sandbox.";
const fixesNotIncluded = "The Fix round failed its Test run, so its fixes are not included: the Reviewer's Fixable findings are among the Open findings.";
const noneFixed = "The Fix round failed, so none of these Fixable findings is fixed:";
const unreadableReview = "The Reviewer's reply gives no <fixable-findings> block and <open-findings> block the Host can read, so its findings are unknown.";
const unchecked = "The Wrap-up gave no Open findings the Host can read, so whether these Fixable findings are fixed is unchecked:";
const acceptanceCriteria = "## Acceptance criteria";
const reviewerSays = `${loopMarker}\n**The AFK loop's Reviewer:**`;

export function issueBranchPrefix(issueNumber: number): string {
  return `issue/${issueNumber}-`;
}

export async function runAfkLoop(loop: AfkLoopOptions): Promise<Outcome[]> {
  const cap = loop.cap ?? defaultCap;
  const outcomes: Outcome[] = [];
  const worked = () => outcomes.filter((o) => o.kind !== "local-branch").length;
  while (worked() < cap) {
    const issue = nextEligibleIssue(await loop.tracker.backlog(), outcomes);
    if (!issue) break;
    const working = brief(issue, loop.tracker).then((briefed) => work(briefed, loop));
    const outcome = await working.catch((error: unknown): Outcome => ({ issue: issue.number, kind: "error", message: String(error) }));
    outcomes.push(outcome);
    if (outcome.kind === "error") break;
  }
  return outcomes;
}

async function brief(issue: Issue, tracker: Tracker): Promise<Issue> {
  const withComments = { ...issue, comments: await tracker.issueComments(issue.number) };
  const numbers = linkedIssueNumbers(withComments);
  return numbers.length > 0 ? { ...withComments, linkedIssues: await tracker.linkedIssues(numbers) } : withComments;
}

function nextEligibleIssue(backlog: Backlog, outcomes: readonly Outcome[]): Issue | undefined {
  const seen = new Set(outcomes.map((o) => o.issue));
  const isEligible = (issue: Issue) =>
    issue.labels.includes(readyForAgent) &&
    issue.openBlockers === 0 &&
    !backlog.issuesWithOpenPullRequest.includes(issue.number) &&
    !backlog.pushedBranches.some((branch) => branch.startsWith(issueBranchPrefix(issue.number))) &&
    !seen.has(issue.number);
  return backlog.issues.filter(isEligible).sort((a, b) => rank(a) - rank(b) || a.number - b.number)[0];
}

function rank(issue: Issue): number {
  const index = priorities.findIndex((priority) => issue.labels.includes(priority));
  return index === -1 ? priorities.length : index;
}

async function work(issue: Issue, loop: AfkLoopOptions): Promise<Outcome> {
  const localBranches = await loop.agents.localBranches(issue.number);
  const kept = localBranches.find((branch) => !branch.leftover);
  if (kept) return { issue: issue.number, kind: "local-branch", branch: kept.name };
  const missing = missingAcceptanceCriteria(issue);
  if (missing) return handOff(issue, { issue: issue.number, kind: "handoff", reason: "no-acceptance-criteria", missing }, loop.tracker);
  for (const leftover of localBranches) await loop.agents.discardLeftover(leftover.name);

  const outcome = await runSession(issue, loop);
  if (outcome.kind === "handoff") return handOff(issue, outcome, loop.tracker);
  if (outcome.kind !== "pull-request") return outcome;
  const pullRequest = await openPullRequest(issue, outcome, loop);
  await postOpenFindings(pullRequest, outcome.openFindings, loop.tracker);
  return outcome;
}

function missingAcceptanceCriteria({ body }: Issue): NoAcceptanceCriteria["missing"] | undefined {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Acceptance criteria\s*$/i.test(line.trim()));
  if (start === -1) return "section";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  const section = end === -1 ? rest : rest.slice(0, end);
  return section.some((line) => /^\s*(?:[-*+]|\d+[.)])\s+(?!\[[ xX]\]\s*$)\S/.test(line)) ? undefined : "items";
}

async function runSession(issue: Issue, loop: AfkLoopOptions): Promise<Outcome> {
  const branch = branchName(issue);
  const session = await loop.agents.start(issue, branch);
  try {
    return await spendAttempts(issue, branch, session, loop.testRunner);
  } finally {
    await session.close();
  }
}

async function spendAttempts(issue: Issue, branch: string, session: IssueSession, testRunner: TestRunner): Promise<Outcome> {
  let lastFailure: { head: string; log: string } | undefined;
  let feedback: string | undefined;
  let worktree: WorktreeState | undefined;
  let fixRound: FixRound | undefined;
  let reviewedPlatforms: readonly Platform[] = [];
  let failures = 0;
  const reviewLogs: string[] = [];
  const fail = (nextFeedback: string) => {
    feedback = nextFeedback;
    failures += 1;
  };
  const reviewerRun = async <R extends { readonly log: string }>(run: Promise<R>, head: string): Promise<R> => {
    const review = await run;
    await session.putBack(head);
    reviewLogs.push(review.log);
    return review;
  };
  const pullRequest = async ({ openFindings, pullRequestDraft }: Review, head: string, platforms: readonly Platform[], fixRoundFailed?: true): Promise<Outcome> => {
    const behaviorCheck = await checkBehavior(session, head, platforms);
    return {
      issue: issue.number,
      kind: "pull-request",
      branch,
      reviewLogs,
      platforms,
      openFindings,
      ...(pullRequestDraft ? { pullRequestDraft } : {}),
      ...(fixRoundFailed ? { fixRoundFailed } : {}),
      ...(behaviorCheck ? { behaviorCheck } : {}),
    };
  };
  const wrapUp = async (round: FixRound, head: string, platforms: readonly Platform[]): Promise<Outcome> => {
    const review = await reviewerRun(session.wrapUp(round), head);
    return pullRequest({ ...review, openFindings: finalOpenFindings(round, review.openFindings) }, head, platforms, round.failed);
  };
  while (failures < attemptBudget) {
    const run = await session.implement(feedback, fixRound?.fixableFindings);
    if (!fixRound && run.contradiction) {
      return { issue: issue.number, kind: "handoff", branch, reason: "contradiction", contradiction: run.contradiction, implementerLog: run.log };
    }
    worktree = await session.inspect();
    if (!fixRound && !worktree.dirty && worktree.commitsAhead === 0) {
      return { issue: issue.number, kind: "handoff", branch, reason: "no-commits", lastReply: run.reply, implementerLog: run.log };
    }
    if (fixRound && run.findingsLeft) fixRound = { ...fixRound, findingsLeft: run.findingsLeft };
    if (worktree.dirty) {
      fail(dirtyFeedback);
      continue;
    }
    if (worktree.head !== fixRound?.reviewedHead) {
      if (worktree.head === lastFailure?.head) {
        fail(`${unchangedHeadFeedback}\n\n${lastFailure.log}`);
        continue;
      }
      const testRun = await testChangedPlatforms(testRunner, session.exec, branch, worktree.platforms);
      if (!testRun.passed) {
        lastFailure = { head: worktree.head, log: testRun.log };
        fail(testRun.log);
        continue;
      }
    }

    if (fixRound) return wrapUp(fixRound, worktree.head, worktree.platforms);
    const review = await reviewerRun(session.review(), worktree.head);
    if (review.unreadable) throw new Error(`${unreadableReview} Its log: ${review.log}`);
    if (!review.fixableFindings) return pullRequest(review, worktree.head, worktree.platforms);
    fixRound = { fixableFindings: review.fixableFindings, openFindings: review.openFindings, reviewedHead: worktree.head };
    reviewedPlatforms = worktree.platforms;
    lastFailure = undefined;
    feedback = undefined;
  }
  if (fixRound) {
    await session.putBack(fixRound.reviewedHead);
    return wrapUp({ ...fixRound, failed: true }, fixRound.reviewedHead, reviewedPlatforms);
  }
  const log = worktree?.dirty && lastFailure ? `${dirtyFeedback}\n\nThe Test run before it reported:\n\n${lastFailure.log}` : (feedback ?? "");
  return {
    issue: issue.number,
    kind: "handoff",
    branch,
    reason: "attempt-budget",
    log,
    ...(lastFailure ? { rawLog: testRunner.rawLogPath(branch) } : {}),
  };
}

async function checkBehavior(session: IssueSession, head: string, platforms: readonly Platform[]): Promise<BehaviorCheck | undefined> {
  const verifySkill = platforms.find((platform) => platform.verifySkill)?.verifySkill;
  if (!verifySkill) return undefined;
  const run = await session.verify(verifySkill, head);
  const changed = run.dirty || run.head !== head;
  if (changed) await session.putBack(head);
  const reading = changed ? inconclusive("the Verifier changed the branch") : hostReads(run.manifest, head, run.files);
  return { ...reading, head, verifySkill, log: run.log, evidence: run.evidence };
}

function behaviorLines(platforms: readonly Platform[], check?: BehaviorCheck, uploadError?: string): string[] {
  if (check) return [behaviorSection(check, uploadError)];
  return platforms.some((platform) => platform.verifySkill) ? [noBehaviorCheck] : [];
}

function finalOpenFindings({ fixableFindings, openFindings, failed }: FixRound, wrapUp?: readonly OpenFinding[]): readonly OpenFinding[] {
  if (!failed) return wrapUp ?? [...openFindings, { text: `${unchecked}\n\n${fixableFindings}` }];
  if (wrapUp && wrapUp.length > openFindings.length) return wrapUp;
  return [...(wrapUp?.length === openFindings.length ? wrapUp : openFindings), { text: `${noneFixed}\n\n${fixableFindings}` }];
}

function withoutClosingKeywords(draft: string): string {
  return draft.replace(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(:?\s+(?:[\w.-]+\/[\w.-]+)?#\d+)/gi, "Refs$1");
}

async function openPullRequest(issue: Issue, { branch, reviewLogs, platforms, openFindings, pullRequestDraft, fixRoundFailed, behaviorCheck }: ReviewedOutcome, loop: AfkLoopOptions): Promise<string> {
  await loop.tracker.pushBranch(branch);
  const body = (uploadError?: string) =>
    [
      `Closes #${issue.number}.`,
      ...(pullRequestDraft ? [withoutClosingKeywords(pullRequestDraft)] : []),
      implementedBy,
      `${reviewedBy} Its logs on the Host: ${reviewLogs.map((log) => `\`${log}\``).join(", ")}. ${openFindingsPosted(openFindings.length)}`,
      ...(fixRoundFailed ? [fixesNotIncluded] : []),
      verifiedLine(loop.platforms, platforms),
      ...behaviorLines(loop.platforms, behaviorCheck, uploadError),
    ].join("\n\n");
  const files = behaviorCheck ? attachList(behaviorCheck).map((file) => `${behaviorCheck.evidence}${file}`) : [];
  const pullRequest = await loop.tracker.openPullRequest({
    branch,
    title: `[#${issue.number}] - ${summary(issue)}`,
    body: body(),
    ...(files.length ? { attachments: { files, unattached: body } } : {}),
  });
  await loop.tracker.relabel(issue.number, { remove: readyForAgent });
  return pullRequest;
}

function openFindingsPosted(count: number): string {
  if (count === 0) return "It left no Open finding.";
  return `It posted ${count} Open ${count === 1 ? "finding" : "findings"} as review comments on this PR.`;
}

async function postOpenFindings(pullRequest: string, findings: readonly OpenFinding[], tracker: Tracker): Promise<void> {
  if (findings.length === 0) return;
  try {
    await tracker.postReview(pullRequest, reviewOf(findings, "inline"));
  } catch {
    await tracker.postReview(pullRequest, reviewOf(findings, "body"));
  }
}

function reviewOf(findings: readonly OpenFinding[], placed: "inline" | "body"): PullRequestReview {
  const comments = findings.flatMap(({ at, text }) => (placed === "inline" && at?.line ? [{ path: at.path, line: at.line, body: `${reviewerSays}\n\n${text}` }] : []));
  const inBody = placed === "inline" ? findings.filter(({ at }) => !at?.line) : findings;
  return { body: inBody.length > 0 ? [reviewerSays, inBody.map(bullet).join("\n")].join("\n\n") : "", comments };
}

function bullet({ at, text }: OpenFinding): string {
  const where = at ? `\`${at.line ? `${at.path}:${at.line}` : at.path}\`: ` : "";
  return `- ${where}${text.replaceAll("\n", "\n  ")}`;
}

async function handOff(issue: Issue, handoff: HandoffOutcome, tracker: Tracker): Promise<HandoffOutcome> {
  await tracker.relabel(issue.number, { remove: readyForAgent, add: readyForHuman });
  const { why, details, settle = "" } = describeHandoff(handoff);
  const requeue =
    handoff.reason === "no-acceptance-criteria"
      ? [`To requeue for the loop: add a \`${acceptanceCriteria}\` section with at least one item to this issue, then relabel the issue \`${readyForAgent}\`.`]
      : [
          `Nothing is pushed. What the session left, if anything, is on the Host: on the local branch \`${handoff.branch}\`, or uncommitted in its worktree.`,
          `To requeue for the loop: ${settle}remove the local \`${handoff.branch}\` branch and its worktree, if they are still there, then relabel the issue \`${readyForAgent}\`.`,
        ];
  await tracker.comment(issue.number, [`${loopMarker}\n${handedOff} ${why}.`, details, ...requeue].join("\n\n"));
  return handoff;
}

export function describeHandoff(handoff: HandoffOutcome): { why: string; details: string; settle?: string } {
  if (handoff.reason === "no-acceptance-criteria") {
    return {
      why: handoff.missing === "section" ? `the issue has no \`${acceptanceCriteria}\` section` : `the issue's \`${acceptanceCriteria}\` section has no items`,
      details: `The loop works an issue only when its \`${acceptanceCriteria}\` section has at least one item. No Sandbox was opened and no Attempt was spent.`,
    };
  }
  if (handoff.reason === "contradiction") {
    return {
      why: "the Implementer found a Contradiction in the issue",
      details: `The parts that disagree, as the Implementer gave them (its log on the Host: \`${handoff.implementerLog}\`):\n\n${fenced(handoff.contradiction)}`,
      settle: "add a comment on this issue saying which part holds, ",
    };
  }
  if (handoff.reason === "no-commits") {
    return {
      why: "the Implementer made no commits",
      details: `The Implementer's last reply (its log on the Host: \`${handoff.implementerLog}\`):\n\n${fenced(handoff.lastReply)}`,
    };
  }
  return { why: budgetSpentWhy, details: lastAttemptDetails(handoff.log, handoff.rawLog) };
}

function summary(issue: Issue): string {
  return issue.title.replace(/^\[#\d+\]\s*(-\s*)?/, "");
}

function branchName(issue: Issue): string {
  const words = summary(issue).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return `${issueBranchPrefix(issue.number)}${words.slice(0, 4).join("-")}`;
}
