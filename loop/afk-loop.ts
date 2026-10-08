import {
  attemptBudget,
  budgetSpentWhy,
  dirtyFeedback,
  fenced,
  lastAttemptDetails,
  readyForAgent,
  readyForHuman,
  unchangedHeadFeedback,
} from "./loop-rules.js";
import { linkedIssueNumbers } from "./linked-issues.js";
import { testChangedPlatforms, verifiedLine, type Platform } from "./platforms.js";
import { revise } from "./revision.js";

export interface Issue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly openBlockers: number;
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
  readonly label: string;
}

export interface Relabel {
  readonly remove: string;
  readonly add?: string;
}

export interface RevisionPullRequest {
  readonly number: number;
  readonly branch: string;
  readonly issue: Issue;
  readonly revision: number;
}

export interface CommentLine {
  readonly author: string;
  readonly body: string;
}

export type ReviewComment = CommentLine & { readonly replies: readonly CommentLine[] } & (
    | { readonly kind: "inline"; readonly thread: string; readonly path: string; readonly line?: number; readonly diffHunk: string }
    | { readonly kind: "conversation" }
  );

export type NumberedComment = ReviewComment & { readonly id: string };

export interface Tracker {
  backlog(): Promise<Backlog>;
  revisionPullRequests(): Promise<RevisionPullRequest[]>;
  linkedIssues(numbers: readonly number[]): Promise<LinkedIssue[]>;
  reviewComments(pullRequest: number): Promise<ReviewComment[]>;
  replyInThread(thread: string, body: string): Promise<void>;
  resolveThread(thread: string): Promise<void>;
  pushBranch(branch: string): Promise<void>;
  openPullRequest(pullRequest: PullRequest): Promise<string>;
  comment(issueOrPullRequest: number, body: string): Promise<void>;
  relabel(issueOrPullRequest: number, relabel: Relabel): Promise<void>;
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
  implement(feedback?: string): Promise<ImplementerRun>;
  review(feedback?: string): Promise<Review>;
  draft(testRun: string): Promise<string | undefined>;
}

export interface ImplementerRun {
  readonly reply: string;
  readonly log: string;
}

export interface Review {
  readonly log: string;
  readonly openFindings: boolean;
  readonly unfixedFindings?: string;
}

export interface RevisionRun {
  readonly output: string;
  readonly log: string;
}

export interface RevisionSession extends Session {
  revise(feedback?: string): Promise<RevisionRun>;
  discard(): Promise<void>;
}

export type RevisionStart =
  | { readonly kind: "session"; readonly session: RevisionSession }
  | { readonly kind: "hand-work" }
  | { readonly kind: "merge-conflict"; readonly files: string[] };

export interface Agents {
  localBranches(issueNumber: number): Promise<LocalBranch[]>;
  discardLeftover(branch: string): Promise<void>;
  start(issue: Issue, branch: string): Promise<IssueSession>;
  startRevision(pullRequest: RevisionPullRequest, comments: readonly NumberedComment[]): Promise<RevisionStart>;
}

export interface TestRunner {
  run(sandbox: SandboxExec, branch: string, platforms: readonly Platform[]): Promise<{ passed: boolean; log: string }>;
  rawLogPath(branch: string): string;
}

export type HandoffOutcome = {
  readonly issue: number;
  readonly kind: "handoff";
  readonly branch: string;
} & (
  | { readonly reason: "attempt-budget"; readonly lastGreenHead?: string; readonly log: string; readonly rawLog?: string }
  | { readonly reason: "no-commits"; readonly lastReply: string; readonly implementerLog: string }
);

export interface ReviewedOutcome {
  readonly issue: number;
  readonly kind: "pull-request";
  readonly branch: string;
  readonly reviewLogs: string[];
  readonly platforms: readonly Platform[];
  readonly openFindings: boolean;
  readonly unfixedFindings?: string;
  readonly pullRequestDraft?: string;
}

export type RevisionHandoffOutcome = {
  readonly issue: number;
  readonly kind: "revision-handoff";
  readonly pullRequest: number;
} & (
  | { readonly reason: "merge-conflict"; readonly baseBranch: string; readonly files: string[] }
  | { readonly reason: "attempt-budget"; readonly log: string; readonly rawLog?: string }
);

export type Outcome =
  | ReviewedOutcome
  | HandoffOutcome
  | { readonly issue: number; readonly kind: "revised"; readonly pullRequest: number; readonly pushed: boolean; readonly log: string }
  | { readonly issue: number; readonly kind: "no-review-comments"; readonly pullRequest: number }
  | RevisionHandoffOutcome
  | { readonly issue: number; readonly kind: "local-branch"; readonly branch: string }
  | { readonly issue: number; readonly kind: "error"; readonly message: string };

export interface AfkLoopOptions {
  readonly tracker: Tracker;
  readonly agents: Agents;
  readonly testRunner: TestRunner;
  readonly cap?: number;
  readonly baseBranch: string;
  readonly platforms: readonly Platform[];
}

export const defaultCap = 5;
const priorities = ["priority:p0", "priority:p1", "priority:p2"];
const draftRuns = 2;
const implementedBy = "Implemented by the AFK loop's Implementer in the Sandbox.";
const reviewedBy = "Reviewed by the AFK loop's Reviewer in the Sandbox; its fixes, if any, are on the branch.";
const allFixed = "It left no finding unfixed.";
const leftUnfixed = "It left these findings unfixed:";

export function issueBranchPrefix(issueNumber: number): string {
  return `issue/${issueNumber}-`;
}

export function issueNumberOf(branch: string): number | undefined {
  const issueNumber = branch.match(/^issue\/(\d+)-/)?.[1];
  return issueNumber ? Number(issueNumber) : undefined;
}

export async function runAfkLoop(loop: AfkLoopOptions): Promise<Outcome[]> {
  const cap = loop.cap ?? defaultCap;
  const outcomes: Outcome[] = [];
  const worked = () => outcomes.filter((o) => o.kind !== "local-branch" && o.kind !== "no-review-comments").length;
  const revised = new Set<number>();
  while (worked() < cap) {
    const pullRequest = await nextRevisionPullRequest(loop.tracker, revised);
    const issue = pullRequest?.issue ?? nextEligibleIssue(await loop.tracker.backlog(), outcomes);
    if (!issue) break;
    const working = withLinkedIssues(issue, loop.tracker).then((briefed) => (pullRequest ? revise({ ...pullRequest, issue: briefed }, loop) : work(briefed, loop)));
    const outcome = await working.catch((error: unknown): Outcome => ({ issue: issue.number, kind: "error", message: String(error) }));
    outcomes.push(outcome);
    if (outcome.kind === "error") break;
  }
  return outcomes;
}

async function withLinkedIssues(issue: Issue, tracker: Tracker): Promise<Issue> {
  const numbers = linkedIssueNumbers(issue);
  return numbers.length > 0 ? { ...issue, linkedIssues: await tracker.linkedIssues(numbers) } : issue;
}

async function nextRevisionPullRequest(tracker: Tracker, revised: Set<number>): Promise<RevisionPullRequest | undefined> {
  const pullRequests = await tracker.revisionPullRequests();
  const next = pullRequests.filter((pullRequest) => !revised.has(pullRequest.number)).sort((a, b) => a.number - b.number)[0];
  if (next) revised.add(next.number);
  return next;
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
  for (const leftover of localBranches) await loop.agents.discardLeftover(leftover.name);

  const outcome = await runSession(issue, loop);
  if (outcome.kind === "handoff") return handOff(issue, outcome, loop.tracker);
  if (outcome.kind !== "pull-request") return outcome;
  await openPullRequest(issue, outcome, loop);
  return outcome;
}

async function runSession(issue: Issue, loop: AfkLoopOptions): Promise<Outcome> {
  const branch = branchName(issue);
  const session = await loop.agents.start(issue, branch);
  try {
    const outcome = await spendAttempts(issue, branch, session, loop.testRunner);
    if (outcome.kind !== "pull-request") return outcome;
    const pullRequestDraft = await draftPullRequest(session, verifiedLine(loop.platforms, outcome.platforms));
    return pullRequestDraft ? { ...outcome, pullRequestDraft } : outcome;
  } finally {
    await session.close();
  }
}

async function draftPullRequest(session: IssueSession, verified: string): Promise<string | undefined> {
  for (let run = 0; run < draftRuns; run += 1) {
    const draft = await session.draft(verified).catch(() => undefined);
    if (draft) return draft;
  }
  return undefined;
}

async function spendAttempts(issue: Issue, branch: string, session: IssueSession, testRunner: TestRunner): Promise<Outcome> {
  let lastFailure: { head: string; log: string } | undefined;
  let feedback: string | undefined;
  let worktree: WorktreeState | undefined;
  let lastGreenHead: string | undefined;
  let failures = 0;
  const reviewLogs: string[] = [];
  let openFindings = false;
  let unfixedFindings: string | undefined;
  const fail = (nextFeedback: string) => {
    feedback = nextFeedback;
    failures += 1;
  };
  while (failures < attemptBudget) {
    if (lastGreenHead) {
      const review = await session.review(feedback);
      reviewLogs.push(review.log);
      if (!feedback) ({ openFindings, unfixedFindings } = review);
      worktree = await session.inspect();
    } else {
      const run = await session.implement(feedback);
      worktree = await session.inspect();
      if (!worktree.dirty && worktree.commitsAhead === 0) {
        return { issue: issue.number, kind: "handoff", branch, reason: "no-commits", lastReply: run.reply, implementerLog: run.log };
      }
    }
    if (worktree.dirty) {
      fail(dirtyFeedback);
      continue;
    }
    if (worktree.commitsAhead === 0 && lastGreenHead) {
      fail(lostCommitsFeedback(lastGreenHead));
      continue;
    }
    const reviewed: Outcome = { issue: issue.number, kind: "pull-request", branch, reviewLogs, platforms: worktree.platforms, openFindings, ...(unfixedFindings ? { unfixedFindings } : {}) };
    if (worktree.head === lastGreenHead) return reviewed;
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
    if (lastGreenHead) return reviewed;
    lastGreenHead = worktree.head;
    lastFailure = undefined;
    feedback = undefined;
  }
  const log = worktree?.dirty && lastFailure ? `${dirtyFeedback}\n\nThe Test run before it reported:\n\n${lastFailure.log}` : (feedback ?? "");
  return {
    issue: issue.number,
    kind: "handoff",
    branch,
    reason: "attempt-budget",
    log,
    ...(lastFailure ? { rawLog: testRunner.rawLogPath(branch) } : {}),
    ...(lastGreenHead ? { lastGreenHead } : {}),
  };
}

function lostCommitsFeedback(lastGreenHead: string): string {
  return `Your last run removed the branch's commits. Restore them: the last commit that passed the Test run is ${lastGreenHead}.`;
}

function withoutClosingKeywords(draft: string): string {
  return draft.replace(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(:?\s+(?:[\w.-]+\/[\w.-]+)?#\d+)/gi, "Refs$1");
}

async function openPullRequest(issue: Issue, { branch, reviewLogs, platforms, unfixedFindings, pullRequestDraft }: ReviewedOutcome, loop: AfkLoopOptions): Promise<string> {
  await loop.tracker.pushBranch(branch);
  const pullRequest = await loop.tracker.openPullRequest({
    branch,
    title: `[#${issue.number}] - ${summary(issue)}`,
    body: [
      `Closes #${issue.number}.`,
      ...(pullRequestDraft ? [withoutClosingKeywords(pullRequestDraft)] : []),
      implementedBy,
      `${reviewedBy} Its logs on the Host: ${reviewLogs.map((log) => `\`${log}\``).join(", ")}. ${unfixedFindings ? leftUnfixed : allFixed}`,
      ...(unfixedFindings ? [unfixedFindings] : []),
      verifiedLine(loop.platforms, platforms),
    ].join("\n\n"),
    label: readyForHuman,
  });
  await loop.tracker.relabel(issue.number, { remove: readyForAgent });
  return pullRequest;
}

async function handOff(issue: Issue, handoff: HandoffOutcome, tracker: Tracker): Promise<HandoffOutcome> {
  await tracker.relabel(issue.number, { remove: readyForAgent, add: readyForHuman });
  const { branch } = handoff;
  const { why, details } = describeHandoff(handoff);
  await tracker.comment(
    issue.number,
    [
      `Handed off to a human: ${why}.`,
      details,
      `The branch \`${branch}\` and its worktree stay on the Host; nothing is pushed.`,
      `To requeue for the loop: remove the local \`${branch}\` branch and its worktree, relabel the issue \`${readyForAgent}\`.`,
    ].join("\n\n"),
  );
  return handoff;
}

export function describeHandoff(handoff: HandoffOutcome): { why: string; details: string } {
  if (handoff.reason === "no-commits") {
    return {
      why: "the Implementer made no commits",
      details: `The Implementer's last reply (its log on the Host: \`${handoff.implementerLog}\`):\n\n${fenced(handoff.lastReply)}`,
    };
  }
  const why = handoff.lastGreenHead
    ? `the Attempt budget (${attemptBudget}) ran out in review, after the Implementer's green Test run (last green at \`${handoff.lastGreenHead}\`)`
    : budgetSpentWhy;
  return { why, details: lastAttemptDetails(handoff.log, handoff.rawLog) };
}

function summary(issue: Issue): string {
  return issue.title.replace(/^\[#\d+\]\s*(-\s*)?/, "");
}

function branchName(issue: Issue): string {
  const words = summary(issue).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return `${issueBranchPrefix(issue.number)}${words.slice(0, 4).join("-")}`;
}
