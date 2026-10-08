import type {
  AfkLoopOptions,
  TestRunner,
  NumberedComment,
  Outcome,
  RevisionHandoffOutcome,
  RevisionPullRequest,
  RevisionSession,
  Tracker,
} from "./afk-loop.js";
import {
  attemptBudget,
  budgetSpentWhy,
  dirtyFeedback,
  fenced,
  lastAttemptDetails,
  loopMarker,
  readyForAgent,
  readyForHuman,
  revisionSummaryMarker,
  unchangedHeadFeedback,
} from "./loop-rules.js";
import { testChangedPlatforms } from "./platforms.js";
import { readReplies, unansweredFeedback, verdicts, type Reply } from "./revision-replies.js";

type Pass =
  | { readonly kind: "answered"; readonly replies: Reply[]; readonly log: string; readonly head?: string }
  | { readonly kind: "handoff"; readonly reason: "attempt-budget"; readonly log: string; readonly rawLog?: string };

export const fixedWithoutCommitFeedback = "Your replies mark a comment `fixed`, but your last run added no commit to push. Commit the fix, or change the verdict.";

export async function revise(pullRequest: RevisionPullRequest, loop: AfkLoopOptions): Promise<Outcome> {
  const { tracker } = loop;
  const { number, branch } = pullRequest;
  const issue = pullRequest.issue.number;
  const returnToMaintainer = async (body: string) => {
    await tracker.comment(number, `${loopMarker}\n${body}`);
    await tracker.relabel(number, { remove: readyForAgent, add: readyForHuman });
  };

  const comments = (await tracker.reviewComments(number)).map((comment, index) => ({ ...comment, id: `C${index + 1}` }));
  if (comments.length === 0) {
    await returnToMaintainer("Revision: no open review comments found. Comment on the PR, then relabel it `ready-for-agent`.");
    return { issue, kind: "no-review-comments", pullRequest: number };
  }

  const start = await loop.agents.startRevision(pullRequest, comments);
  if (start.kind === "hand-work") {
    await returnToMaintainer(`Revision skipped: the local \`${branch}\` has work that isn't pushed. Push or remove it, then relabel the PR \`ready-for-agent\`.`);
    return { issue, kind: "local-branch", branch };
  }
  if (start.kind === "merge-conflict") {
    return handOff({ issue, kind: "revision-handoff", pullRequest: number, reason: "merge-conflict", baseBranch: loop.baseBranch, files: start.files }, returnToMaintainer);
  }

  const pass = await runPass(branch, comments, start.session, loop);
  if (pass.kind === "handoff") {
    const { kind, ...handoff } = pass;
    return handOff({ issue, kind: "revision-handoff", pullRequest: number, ...handoff }, returnToMaintainer);
  }

  await answer(pass.replies, tracker);
  await tracker.comment(number, summaryComment(pullRequest, pass));
  await tracker.relabel(number, { remove: readyForAgent, add: readyForHuman });
  return { issue, kind: "revised", pullRequest: number, pushed: !!pass.head, log: pass.log };
}

async function runPass(branch: string, comments: NumberedComment[], session: RevisionSession, { testRunner, tracker }: AfkLoopOptions): Promise<Pass> {
  let pass: Pass | undefined;
  let settled = false;
  try {
    pass = await spendAttempts(branch, comments, session, testRunner);
    if (pass.kind === "answered" && pass.head) await tracker.pushBranch(branch);
    settled = true;
    return pass;
  } finally {
    if (pass?.kind === "answered" && settled) await session.close();
    else await session.discard();
  }
}

async function spendAttempts(branch: string, comments: NumberedComment[], session: RevisionSession, testRunner: TestRunner): Promise<Pass> {
  const start = await session.inspect();
  let lastFailure: { head: string; log: string } | undefined;
  let feedback: string | undefined;
  let failures = 0;
  const fail = (nextFeedback: string) => {
    feedback = nextFeedback;
    failures += 1;
  };
  while (failures < attemptBudget) {
    const run = await session.revise(feedback);

    const worktree = await session.inspect();
    if (worktree.dirty) {
      fail(dirtyFeedback);
      continue;
    }
    const { replies, unanswered } = readReplies(run.output, comments);
    if (unanswered.length > 0) {
      fail(unansweredFeedback(unanswered, comments));
      continue;
    }
    const nothingToPush = worktree.head === start.head || worktree.commitsAhead === 0;
    if (nothingToPush && replies.some((reply) => reply.verdict === "fixed")) {
      fail(fixedWithoutCommitFeedback);
      continue;
    }
    if (worktree.commitsAhead === 0) return { kind: "answered", replies, log: run.log };
    if (worktree.head === lastFailure?.head) {
      fail(`${unchangedHeadFeedback}\n\n${lastFailure.log}`);
      continue;
    }

    const testRun = await testChangedPlatforms(testRunner, session.exec, branch, worktree.platforms);
    if (testRun.passed) return { kind: "answered", replies, log: run.log, head: worktree.head };
    lastFailure = { head: worktree.head, log: testRun.log };
    fail(testRun.log);
  }
  return { kind: "handoff", reason: "attempt-budget", log: feedback ?? "", ...(lastFailure ? { rawLog: testRunner.rawLogPath(branch) } : {}) };
}

async function answer(replies: Reply[], tracker: Tracker) {
  for (const { comment, verdict, text } of replies) {
    if (comment.kind !== "inline") continue;
    await tracker.replyInThread(comment.thread, `${loopMarker}\n**${verdict}**: ${text}`);
    if (verdict === "fixed") await tracker.resolveThread(comment.thread);
  }
}

function summaryComment(pullRequest: RevisionPullRequest, pass: Pass & { kind: "answered" }): string {
  const counts = verdicts.map((verdict) => `${pass.replies.filter((reply) => reply.verdict === verdict).length} ${verdict}`);
  const unthreaded = pass.replies
    .filter((reply) => reply.comment.kind === "conversation")
    .map(({ comment, verdict, text }) => `- "${excerpt(comment.body)}" → **${verdict}**: ${text}`);
  return [
    revisionSummaryMarker,
    `Revision ${pullRequest.revision}: ${counts.join(", ")}.`,
    pass.head
      ? `Pushed \`${pass.head}\` after a green Test run. Fixed threads are resolved; the others stay open with a reply.`
      : "Nothing to push. Every thread stays open with a reply.",
    ...(unthreaded.length > 0 ? [unthreaded.join("\n")] : []),
    `Implementer log on the Host: \`${pass.log}\``,
  ].join("\n\n");
}

function excerpt(body: string): string {
  const firstLine = body.split("\n")[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

async function handOff(handoff: RevisionHandoffOutcome, returnToMaintainer: (body: string) => Promise<void>): Promise<RevisionHandoffOutcome> {
  const { why, details } = describeRevisionHandoff(handoff);
  await returnToMaintainer(
    [
      `Revision handed off to a human: ${why}.`,
      details,
      "Nothing was pushed and no comment was answered. For another Revision, relabel the PR `ready-for-agent`.",
    ].join("\n\n"),
  );
  return handoff;
}

export function describeRevisionHandoff(handoff: RevisionHandoffOutcome): { why: string; details: string } {
  switch (handoff.reason) {
    case "merge-conflict":
      return { why: `merging \`${handoff.baseBranch}\` into the branch conflicts`, details: `Conflicting files:\n\n${fenced(handoff.files.join("\n"))}` };
    case "attempt-budget":
      return { why: budgetSpentWhy, details: lastAttemptDetails(handoff.log, handoff.rawLog) };
  }
}
