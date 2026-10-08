import {
  attemptBudget,
  budgetSpentWhy,
  dirtyFeedback,
  fenced,
  lastAttemptDetails,
  loopMarker,
  readyForAgent,
  readyForHuman,
  unchangedHeadFeedback,
} from "./loop-rules.js";
import { linkedIssueNumbers } from "./linked-issues.js";
import { testChangedPlatforms, verifiedLine, type Platform } from "./platforms.js";

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

export interface OpenFinding {
  readonly text: string;
  readonly at?: { readonly path: string; readonly line: number };
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
  linkedIssues(numbers: readonly number[]): Promise<LinkedIssue[]>;
  pushBranch(branch: string): Promise<void>;
  openPullRequest(pullRequest: PullRequest): Promise<string>;
  postReview(pullRequest: string, review: PullRequestReview): Promise<void>;
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
  review(): Promise<FirstReview>;
  wrapUp(fixRound: FixRound): Promise<Review>;
  putBack(head: string): Promise<void>;
}

export interface ImplementerRun {
  readonly reply: string;
  readonly log: string;
}

export interface Review {
  readonly log: string;
  readonly openFindings: readonly OpenFinding[];
  readonly pullRequestDraft?: string;
}

export interface FirstReview extends Review {
  readonly fixableFindings?: string;
}

export interface FixRound {
  readonly fixableFindings: string;
  readonly openFindings: readonly OpenFinding[];
  readonly reviewedHead: string;
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
  readonly openFindings: readonly OpenFinding[];
  readonly pullRequestDraft?: string;
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
    const working = withLinkedIssues(issue, loop.tracker).then((briefed) => work(briefed, loop));
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
  const pullRequest = await openPullRequest(issue, outcome, loop);
  await postOpenFindings(pullRequest, outcome.openFindings, loop.tracker);
  return outcome;
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
  let failures = 0;
  const reviewLogs: string[] = [];
  const fail = (nextFeedback: string) => {
    feedback = nextFeedback;
    failures += 1;
  };
  while (failures < attemptBudget) {
    const run = await session.implement(feedback);
    worktree = await session.inspect();
    if (!fixRound && !worktree.dirty && worktree.commitsAhead === 0) {
      return { issue: issue.number, kind: "handoff", branch, reason: "no-commits", lastReply: run.reply, implementerLog: run.log };
    }
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

    const { head, platforms } = worktree;
    const reviewerRun = async <R extends Review>(run: Promise<R>): Promise<R> => {
      const review = await run;
      await session.putBack(head);
      reviewLogs.push(review.log);
      return review;
    };
    const reviewed = ({ openFindings, pullRequestDraft }: Review): Outcome => ({
      issue: issue.number,
      kind: "pull-request",
      branch,
      reviewLogs,
      platforms,
      openFindings,
      ...(pullRequestDraft ? { pullRequestDraft } : {}),
    });
    if (fixRound) return reviewed(await reviewerRun(session.wrapUp(fixRound)));
    const review = await reviewerRun(session.review());
    if (!review.fixableFindings) return reviewed(review);
    fixRound = { fixableFindings: review.fixableFindings, openFindings: review.openFindings, reviewedHead: head };
    lastFailure = undefined;
    feedback = review.fixableFindings;
  }
  const log = worktree?.dirty && lastFailure ? `${dirtyFeedback}\n\nThe Test run before it reported:\n\n${lastFailure.log}` : (feedback ?? "");
  return {
    issue: issue.number,
    kind: "handoff",
    branch,
    reason: "attempt-budget",
    log,
    ...(lastFailure ? { rawLog: testRunner.rawLogPath(branch) } : {}),
    ...(fixRound ? { lastGreenHead: fixRound.reviewedHead } : {}),
  };
}

function withoutClosingKeywords(draft: string): string {
  return draft.replace(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(:?\s+(?:[\w.-]+\/[\w.-]+)?#\d+)/gi, "Refs$1");
}

async function openPullRequest(issue: Issue, { branch, reviewLogs, platforms, openFindings, pullRequestDraft }: ReviewedOutcome, loop: AfkLoopOptions): Promise<string> {
  await loop.tracker.pushBranch(branch);
  const pullRequest = await loop.tracker.openPullRequest({
    branch,
    title: `[#${issue.number}] - ${summary(issue)}`,
    body: [
      `Closes #${issue.number}.`,
      ...(pullRequestDraft ? [withoutClosingKeywords(pullRequestDraft)] : []),
      implementedBy,
      `${reviewedBy} Its logs on the Host: ${reviewLogs.map((log) => `\`${log}\``).join(", ")}. ${openFindingsPosted(openFindings.length)}`,
      verifiedLine(loop.platforms, platforms),
    ].join("\n\n"),
    label: readyForHuman,
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
  const inline = placed === "inline" ? findings.filter((finding) => finding.at) : [];
  const inBody = findings.filter((finding) => !inline.includes(finding));
  return {
    body: inBody.length > 0 ? [reviewerSays, inBody.map(bullet).join("\n")].join("\n\n") : "",
    comments: inline.flatMap(({ at, text }) => (at ? [{ ...at, body: `${reviewerSays}\n\n${text}` }] : [])),
  };
}

function bullet({ at, text }: OpenFinding): string {
  const where = at ? `\`${at.path}:${at.line}\`: ` : "";
  return `- ${where}${text.replaceAll("\n", "\n  ")}`;
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
