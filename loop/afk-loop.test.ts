import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  runAfkLoop,
  type OpenFinding,
  type PullRequestReview,
  type Agents,
  type Backlog,
  type FixRound,
  type Issue,
  type IssueSession,
  type LinkedIssue,
  type LocalBranch,
  type PullRequest,
  type Relabel,
  type SandboxExec,
  type TestRunner,
  type Tracker,
  type VerifierRun,
} from "./afk-loop.js";
import type { Claim, Manifest } from "./behavior-check.js";
import { dirtyFeedback } from "./loop-rules.js";
import type { Platform } from "./platforms.js";

describe("runAfkLoop", () => {
  test("empty backlog is a clean no-op", async () => {
    const { sut, calls } = makeSUT({ issues: [] });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, []);
    assert.deepEqual(calls, []);
  });

  test("only an Eligible issue is worked", async () => {
    const { sut, agents } = makeSUT({
      issues: [
        issue(1, { labels: ["needs-triage"] }),
        issue(2, { openBlockers: 1 }),
        issue(3),
        issue(4),
        issue(5),
      ],
      issuesWithOpenPullRequest: [3],
      pushedBranches: ["issue/4-earlier-work"],
    });

    await sut.run();

    assert.deepEqual(agents.startedIssues, [5]);
  });

  test("Eligible issues go by priority, unlabelled last, then lowest number", async () => {
    const { sut, agents } = makeSUT({
      issues: [
        issue(1),
        issue(2, { labels: ["ready-for-agent", "priority:p2"] }),
        issue(3, { labels: ["ready-for-agent", "priority:p0"] }),
        issue(4, { labels: ["ready-for-agent", "priority:p1"] }),
        issue(5, { labels: ["ready-for-agent", "priority:p0"] }),
      ],
    });

    await sut.run();

    assert.deepEqual(agents.startedIssues, [3, 5, 4, 2, 1]);
  });

  test("an issue naming another issue is started with that issue's text", async () => {
    const verified = { number: 224, title: "Verify the stack", body: "Catalog", comments: [] };
    const { sut, agents } = makeSUT({ issues: [issue(1, { body: `Start from #224.\n\n## Blocked by\n\n- #229\n\n${criteria}` })], linkedIssues: [verified, { ...verified, number: 229 }] });

    await sut.run();

    assert.deepEqual(agents.started[0]?.linkedIssues, [verified]);
  });

  test("an issue is started with its comments", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1)], comments: { 1: ["Use the weekly streak.", "Weeks start on Monday."] } });

    await sut.run();

    assert.deepEqual(agents.started[0]?.comments, ["Use the weekly streak.", "Weeks start on Monday."]);
  });

  test("an issue named in a comment is a Linked issue, except under the comment's Parent and Blocked by headings", async () => {
    const { sut, agents } = makeSUT({
      issues: [issue(1, { body: `## Blocked by\n\n- #229\n\n${criteria}` })],
      comments: { 1: ["## Parent\n\n#226", "Not the receiver of #250; #229 has the stream."] },
      linkedIssues: [226, 229, 250].map(linked),
    });

    await sut.run();

    assert.deepEqual(agents.started[0]?.linkedIssues, [229, 250].map(linked));
  });

  test("the body and the comments share one limit of Linked issues, the body's first", async () => {
    const { sut, agents } = makeSUT({
      issues: [issue(1, { body: `#11 #12 #13\n\n${criteria}` })],
      comments: { 1: ["#14 #15", "#16"] },
      linkedIssues: [16, 15, 14, 13, 12, 11].map(linked),
    });

    await sut.run();

    assert.deepEqual(agents.started[0]?.linkedIssues?.map((issue) => issue.number).sort(), [11, 12, 13, 14, 15]);
  });

  test("an issue whose comments cannot be read is not worked, and the run stops", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1), issue(2)], comments: { 1: "unreadable" } });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 1, kind: "error", message: "Error: comments unreadable" }]);
    assert.deepEqual(agents.startedIssues, []);
  });

  test("a green Attempt is reviewed once, then pushed as a ready-for-human PR closing the issue", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [issue(12, { title: "[#9] - AFK loop tracer: pick issue → PR" })] });
    const branch = "issue/12-afk-loop-tracer-pick";

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 12, kind: "pull-request", branch, reviewLogs: ["logs/review-1"], platforms: [web], openFindings: [] }]);
    assert.deepEqual(calls, [
      `start ${branch}`,
      "implement",
      "inspect",
      `test run ${branch}`,
      "review",
      "put back head-1",
      `close ${branch}`,
      `push ${branch}`,
      `open PR ${branch}`,
      "relabel #12: -ready-for-agent",
    ]);
    assert.equal(tracker.pullRequests[0]?.title, "[#12] - AFK loop tracer: pick issue → PR");
    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #12\.[\s\S]*Reviewer[\s\S]*`logs\/review-1`\. It left no Open finding\.\n/);
  });

  test("a Leftover is discarded before the issue is redone", async () => {
    const { sut, calls } = makeSUT({
      issues: [issue(7, { title: "Fix streak" })],
      localBranches: { 7: [{ name: "issue/7-fix-streak", leftover: true }] },
    });

    const outcomes = await sut.run();

    assert.deepEqual(calls.slice(0, 2), ["discard issue/7-fix-streak", "start issue/7-fix-streak"]);
    assert.equal(outcomes[0]?.kind, "pull-request");
  });

  test("a local branch that isn't a Leftover is kept and its issue skipped", async () => {
    const { sut, agents, calls } = makeSUT({
      issues: [issue(1), issue(2)],
      localBranches: { 1: [{ name: "issue/1-my-work", leftover: false }] },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes[0], { issue: 1, kind: "local-branch", branch: "issue/1-my-work" });
    assert.ok(!calls.some((call) => call.startsWith("discard")));
    assert.deepEqual(agents.startedIssues, [2]);
  });

  test("an Implementer whose first run makes no commits hands off after that one run, with its last reply", async () => {
    const { sut, agents, tracker, calls } = makeSUT({ issues: [issue(1), issue(2)], runs: { 1: [{ commits: 0, reply: "Issue 1 is already done." }] } });
    const branch = "issue/1-issue-1";

    const outcomes = await sut.run();

    assert.deepEqual(outcomes[0], { issue: 1, kind: "handoff", branch, reason: "no-commits", lastReply: "Issue 1 is already done.", implementerLog: "logs/implementer-1" });
    assert.deepEqual(calls.slice(0, 6), [`start ${branch}`, "implement", "inspect", `close ${branch}`, "relabel #1: -ready-for-agent +ready-for-human", "comment on #1"]);
    assert.deepEqual(tracker.comments, [
      [
        "<!-- afk-loop -->\nHanded off to a human: the Implementer made no commits.",
        "The Implementer's last reply (its log on the Host: `logs/implementer-1`):\n\n```text\nIssue 1 is already done.\n```",
        "Nothing is pushed. What the session left, if anything, is on the Host: on the local branch `issue/1-issue-1`, or uncommitted in its worktree.",
        "To requeue for the loop: remove the local `issue/1-issue-1` branch and its worktree, if they are still there, then relabel the issue `ready-for-agent`.",
      ].join("\n\n"),
    ]);
    assert.deepEqual(outcomes.map((o) => [o.issue, o.kind]), [
      [1, "handoff"],
      [2, "pull-request"],
    ]);
    assert.deepEqual(agents.startedIssues, [1, 2]);
    assert.deepEqual(tracker.pushed, ["issue/2-issue-2"]);
    assert.deepEqual(tracker.pullRequests.map((pr) => pr.branch), ["issue/2-issue-2"]);
  });

  test("a Contradiction the Implementer reports is a Handoff, even with commits: no Test run, nothing pushed, and the loop moves on", async () => {
    const contradiction = "The body says the streak is daily.\nThe comment says it is weekly.";
    const { sut, tracker, calls } = makeSUT({ issues: [issue(1), issue(2)], runs: { 1: [{ commits: 2, contradiction }] } });
    const branch = "issue/1-issue-1";

    const outcomes = await sut.run();

    assert.deepEqual(outcomes[0], { issue: 1, kind: "handoff", branch, reason: "contradiction", contradiction, implementerLog: "logs/implementer-1" });
    assert.deepEqual(calls.slice(0, 5), [`start ${branch}`, "implement", `close ${branch}`, "relabel #1: -ready-for-agent +ready-for-human", "comment on #1"]);
    assert.deepEqual(tracker.comments, [
      [
        "<!-- afk-loop -->\nHanded off to a human: the Implementer found a Contradiction in the issue.",
        "The parts that disagree, as the Implementer gave them (its log on the Host: `logs/implementer-1`):\n\n```text\nThe body says the streak is daily.\nThe comment says it is weekly.\n```",
        "Nothing is pushed. What the session left, if anything, is on the Host: on the local branch `issue/1-issue-1`, or uncommitted in its worktree.",
        "To requeue for the loop: add a comment on this issue saying which part holds, remove the local `issue/1-issue-1` branch and its worktree, if they are still there, then relabel the issue `ready-for-agent`.",
      ].join("\n\n"),
    ]);
    assert.deepEqual(outcomes.map((o) => [o.issue, o.kind]), [
      [1, "handoff"],
      [2, "pull-request"],
    ]);
    assert.deepEqual(tracker.pushed, ["issue/2-issue-2"]);
  });

  test("a Contradiction reported after a failed Attempt is a Handoff for the Contradiction", async () => {
    const { sut, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { contradiction: "Daily or weekly." }] }, testRunResults: ["error: boom"] });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes.map((o) => o.kind === "handoff" && o.reason), ["contradiction"]);
    assert.equal(testRuns(calls), 1);
  });

  test("a Contradiction reported in the Fix round is no Handoff: the PR opens", async () => {
    const { sut } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { commits: 0, fixableFindings: "Rename it." }, { contradiction: "Daily or weekly." }, { commits: 0 }] } });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes.map((o) => o.kind), ["pull-request"]);
  });

  test("an Implementer that undoes its uncommitted changes and makes no commits hands off without spending the rest of the budget", async () => {
    const { sut, agents, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{ dirty: true, commits: 0 }, { commits: 0, reply: "Nothing to do." }] } });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 1, kind: "handoff", branch: "issue/1-issue-1", reason: "no-commits", lastReply: "Nothing to do.", implementerLog: "logs/implementer-2" }]);
    assert.deepEqual(agents.feedback, [undefined, dirtyFeedback]);
    assert.deepEqual(tracker.pushed, []);
  });

  test("a failed Test run sends its log to the next Attempt, and a green one opens the PR", async () => {
    const { sut, agents, calls } = makeSUT({ issues: [issue(1)], testRunResults: ["error: boom"] });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 1, kind: "pull-request", branch: "issue/1-issue-1", reviewLogs: ["logs/review-1"], platforms: [web], openFindings: [] }]);
    assert.deepEqual(agents.feedback, [undefined, "error: boom"]);
    assert.equal(testRuns(calls), 2);
  });

  test("a dirty worktree is a failed Attempt that asks for a commit and skips the Test run", async () => {
    const { sut, agents, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{ dirty: true }, {}] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.equal(agents.feedback[1], dirtyFeedback);
    assert.equal(testRuns(calls), 1);
  });

  test("three failed Attempts hand off: the issue relabelled and one comment, nothing pushed and no PR", async () => {
    const { sut, agents, tracker, calls } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { dirty: true }, {}] },
      testRunResults: ["error: one", "error: three"],
    });
    const branch = "issue/1-issue-1";

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [
      {
        issue: 1,
        kind: "handoff",
        branch,
        reason: "attempt-budget",
        log: "error: three",
        rawLog: `raw/${branch}`,
      },
    ]);
    assert.equal(agents.feedback.length, 3);
    assert.deepEqual(calls.slice(-3), [`close ${branch}`, "relabel #1: -ready-for-agent +ready-for-human", "comment on #1"]);
    assert.deepEqual(tracker.pushed, []);
    assert.deepEqual(tracker.pullRequests, []);
    assert.deepEqual(tracker.comments, [
      [
        "<!-- afk-loop -->\nHanded off to a human: the Attempt budget (3) ran out without a green Test run.",
        "Feedback from the last Attempt (Test run output filtered; raw log on the Host: `raw/issue/1-issue-1`):\n\n```text\nerror: three\n```",
        "Nothing is pushed. What the session left, if anything, is on the Host: on the local branch `issue/1-issue-1`, or uncommitted in its worktree.",
        "To requeue for the loop: remove the local `issue/1-issue-1` branch and its worktree, if they are still there, then relabel the issue `ready-for-agent`.",
      ].join("\n\n"),
    ]);
  });

  test("three failed Attempts with no commits hand off the same way", async () => {
    const { sut, tracker, calls } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{ dirty: true, commits: 0 }, { dirty: true, commits: 0 }, { dirty: true, commits: 0 }] },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 1, kind: "handoff", branch: "issue/1-issue-1", reason: "attempt-budget", log: dirtyFeedback }]);
    assert.deepEqual(tracker.pushed, []);
    assert.deepEqual(tracker.pullRequests, []);
    assert.deepEqual(calls.slice(-2), ["relabel #1: -ready-for-agent +ready-for-human", "comment on #1"]);
    assert.deepEqual(tracker.comments, [
      [
        "<!-- afk-loop -->\nHanded off to a human: the Attempt budget (3) ran out without a green Test run.",
        `Feedback from the last Attempt:\n\n\`\`\`text\n${dirtyFeedback}\n\`\`\``,
        "Nothing is pushed. What the session left, if anything, is on the Host: on the local branch `issue/1-issue-1`, or uncommitted in its worktree.",
        "To requeue for the loop: remove the local `issue/1-issue-1` branch and its worktree, if they are still there, then relabel the issue `ready-for-agent`.",
      ].join("\n\n"),
    ]);
  });

  test("a dirty last Attempt hands off with the commit feedback", async () => {
    const { sut } = makeSUT({ issues: [issue(1)], runs: { 1: [{ dirty: true }, { dirty: true }, { dirty: true }] } });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [
      {
        issue: 1,
        kind: "handoff",
        branch: "issue/1-issue-1",
        reason: "attempt-budget",
        log: dirtyFeedback,
      },
    ]);
  });

  test("a dirty last Attempt keeps the last Test run failure in the Handoff log", async () => {
    const { sut } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, {}, { dirty: true }] }, testRunResults: ["error: one", "error: two"] });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [
      {
        issue: 1,
        kind: "handoff",
        branch: "issue/1-issue-1",
        reason: "attempt-budget",
        log: `${dirtyFeedback}\n\nThe Test run before it reported:\n\nerror: two`,
        rawLog: "raw/issue/1-issue-1",
      },
    ]);
  });

  test("a Handoff log too long for GitHub is truncated", async () => {
    const log = `error: ${"x".repeat(70_000)}`;
    const { sut, tracker } = makeSUT({ issues: [issue(1)], testRunResults: [log, log, log] });

    await sut.run();

    const body = tracker.comments[0] ?? "";
    assert.ok(body.length < 65_536);
    assert.match(body, /… truncated\n```\n/);
  });

  test("a Handoff log is fenced past any backticks it holds", async () => {
    const log = "error: ```swift\n@someone ``` mention";
    const { sut, tracker } = makeSUT({ issues: [issue(1)], testRunResults: [log, log, log] });

    await sut.run();

    assert.match(tracker.comments[0] ?? "", /\n````text\nerror: ```swift\n@someone ``` mention\n````/);
  });

  test("the loop moves on to the next Eligible issue after a Handoff", async () => {
    const { sut, agents } = makeSUT({
      issues: [issue(1), issue(2)],
      runs: { 1: [{ dirty: true }, { dirty: true }, { dirty: true }] },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes.map((o) => [o.issue, o.kind]), [
      [1, "handoff"],
      [2, "pull-request"],
    ]);
    assert.deepEqual(agents.startedIssues, [1, 2]);
  });

  test("an unchanged HEAD after a failed Test run fails without rerunning the tests and says so", async () => {
    const { sut, agents, calls } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { commits: 0 }, { commits: 0 }] },
      testRunResults: ["error: one"],
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "handoff");
    assert.match(agents.feedback[2] ?? "", /no new commits[\s\S]*error: one/i);
    assert.equal(testRuns(calls), 1);
  });

  test("a HEAD moved without new commits after a failed Test run is tested again", async () => {
    const { sut, calls } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { commits: 0, movesHead: true }] },
      testRunResults: ["error: one"],
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.equal(testRuns(calls), 2);
  });

  test("the Test run executes in the issue's Sandbox", async () => {
    const { sut, agents, testRunner } = makeSUT({ issues: [issue(1)] });

    await sut.run();

    assert.deepEqual(testRunner.sandboxes, [agents.sandboxes[0]]);
  });

  test("an adapter error is reported and stops the loop", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1), issue(2)], pushFails: true });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 1, kind: "error", message: "Error: push rejected" }]);
    assert.deepEqual(agents.startedIssues, [1]);
  });

  test("the loop stops at the cap, 5 by default", async () => {
    const issues = Array.from({ length: 7 }, (_, i) => issue(i + 1));
    const byDefault = makeSUT({ issues });
    const capped = makeSUT({ issues });

    await byDefault.sut.run();
    await capped.sut.run(2);

    assert.deepEqual(byDefault.agents.startedIssues, [1, 2, 3, 4, 5]);
    assert.deepEqual(capped.agents.startedIssues, [1, 2]);
  });
});

describe("runAfkLoop, PR body", () => {
  test("the Reviewer's draft sits between the Closes line and the Host's own lines", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { pullRequestDraft: "## Summary\n\nShows the Streak badge." }] } });

    await sut.run();

    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\n## Summary\n\nShows the Streak badge\.\n\nImplemented by the AFK loop's Implementer/);
  });

  test("the draft is the one of the Reviewer's last run", async () => {
    const { sut, tracker } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: "Rename `x`.", pullRequestDraft: "## Summary\n\nFirst." }, {}, { pullRequestDraft: "## Summary\n\nLast." }] },
    });

    await sut.run();

    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\n## Summary\n\nLast\.\n\nImplemented by/);
  });

  test("a draft closes no issue of its own", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { pullRequestDraft: "Fixes #9 and closes: acme/Habitat#10. The dialog closes on Save." }] } });

    await sut.run();

    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\nRefs #9 and Refs: acme\/Habitat#10\. The dialog closes on Save\.\n\n/);
  });

  test("with no draft the PR still opens, the Host's own lines following the Closes line", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [issue(1)] });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\nImplemented by the AFK loop's Implementer/);
    assert.deepEqual(calls.filter((call) => call === "implement" || call === "review"), ["implement", "review"]);
  });
});

describe("runAfkLoop, Open findings", () => {
  const onLine: OpenFinding = { text: "The streak resets at UTC midnight.", at: { path: "web/src/streak.ts", line: 12 } };
  const noLine: OpenFinding = { text: "No test covers a skipped day.\nAdd one?" };
  const reviewerSays = "<!-- afk-loop -->\n**The AFK loop's Reviewer:**";

  test("are posted as one review after the PR is opened: inline with a line, in the body without", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { openFindings: [onLine, noLine] }] } });
    const branch = "issue/1-issue-1";

    await sut.run();

    assert.deepEqual(calls.slice(-3), [`open PR ${branch}`, "relabel #1: -ready-for-agent", `post review https://pr/${branch}`]);
    assert.deepEqual(tracker.reviews, [
      {
        body: `${reviewerSays}\n\n- No test covers a skipped day.\n  Add one?`,
        comments: [{ path: "web/src/streak.ts", line: 12, body: `${reviewerSays}\n\nThe streak resets at UTC midnight.` }],
      },
    ]);
  });

  test("a finding with a path and no line is in the body, after its path", async () => {
    const onFile: OpenFinding = { text: "Shallow module.", at: { path: "web/src/streak.ts" } };
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { openFindings: [onFile, onLine] }] } });

    await sut.run();

    assert.equal(tracker.reviews[0]?.body, `${reviewerSays}\n\n- \`web/src/streak.ts\`: Shallow module.`);
    assert.deepEqual(tracker.reviews[0]?.comments.map((comment) => comment.line), [12]);
  });

  test("all on a line: the review has no body", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { openFindings: [onLine] }] } });

    await sut.run();

    assert.equal(tracker.reviews[0]?.body, "");
    assert.equal(tracker.reviews[0]?.comments.length, 1);
  });

  test("none: no review is posted, and the PR body says so", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [issue(1)] });

    await sut.run();

    assert.deepEqual(tracker.reviews, []);
    assert.ok(!calls.some((call) => call.startsWith("post review")));
    assert.match(tracker.pullRequests[0]?.body ?? "", /Its logs on the Host: `[^`\n]+`\. It left no Open finding\.\n\n/);
  });

  test("a rejected review is posted again with every finding in the body, each after its path and line", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { openFindings: [onLine, noLine] }] }, rejectedReviews: 1 });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.equal(tracker.reviews.length, 2);
    assert.deepEqual(tracker.reviews[1], {
      body: `${reviewerSays}\n\n- \`web/src/streak.ts:12\`: The streak resets at UTC midnight.\n- No test covers a skipped day.\n  Add one?`,
      comments: [],
    });
  });

  test("a review rejected twice is an error, and the run stops", async () => {
    const { sut, tracker, agents } = makeSUT({ issues: [issue(1), issue(2)], runs: { 1: [{}, { openFindings: [onLine] }] }, rejectedReviews: 2 });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 1, kind: "error", message: "Error: review rejected" }]);
    assert.equal(tracker.reviews.length, 2);
    assert.deepEqual(agents.startedIssues, [1]);
  });

  test("the PR body counts the findings posted and lists none of them", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { openFindings: [onLine, noLine] }] } });

    await sut.run();

    const body = tracker.pullRequests[0]?.body ?? "";
    assert.match(body, /Its logs on the Host: `[^`\n]+`\. It posted 2 Open findings as review comments on this PR\.\n\n/);
    assert.ok(!body.includes("UTC midnight"));
    assert.ok(!body.includes("skipped day"));
  });

  test("one finding is counted in the singular", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { openFindings: [noLine] }] } });

    await sut.run();

    assert.match(tracker.pullRequests[0]?.body ?? "", /It posted 1 Open finding as review comments on this PR\./);
  });

});

describe("runAfkLoop, Fix round", () => {
  const fixable = "web/src/streak.ts:12: `x` says nothing. Rename it `streakLength`.";
  const onLine: OpenFinding = { text: "The streak resets at UTC midnight.", at: { path: "web/src/streak.ts", line: 12 } };
  const noLine: OpenFinding = { text: "No test covers a skipped day." };
  const branch = "issue/1-issue-1";
  const reviewerSays = "<!-- afk-loop -->\n**The AFK loop's Reviewer:**";
  const unfixed = `The Fix round failed, so none of these Fixable findings is fixed:\n  \n  ${fixable}`;
  const unchecked = "The Wrap-up gave no Open findings the Host can read, so whether these Fixable findings are fixed is unchecked:";
  const agentRuns = (calls: string[]) => calls.filter((call) => ["implement", "review", "wrap up"].includes(call));

  test("no Fixable finding: one Reviewer run, whose draft is the PR body, and no Fix round or wrap-up", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { openFindings: [noLine], pullRequestDraft: "## Summary\n\nOne run." }] } });

    await sut.run();

    assert.deepEqual(agentRuns(calls), ["implement", "review"]);
    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\n## Summary\n\nOne run\.\n\n/);
  });

  test("a first review the Host cannot read is an error after the branch is put back: no PR opens, and the run stops", async () => {
    const { sut, tracker, agents, calls } = makeSUT({ issues: [issue(1), issue(2)], runs: { 1: [{}, { unreadable: true }] } });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [
      {
        issue: 1,
        kind: "error",
        message: "Error: The Reviewer's reply gives no <fixable-findings> block and <open-findings> block the Host can read, so its findings are unknown. Its log: logs/review-1",
      },
    ]);
    assert.deepEqual(calls.slice(-3), ["review", "put back head-1", "close issue/1-issue-1"]);
    assert.deepEqual(tracker.pullRequests, []);
    assert.deepEqual(agents.startedIssues, [1]);
  });

  test("whatever a Reviewer run leaves behind, the branch is put back at the tested commit and no Test run follows", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { commits: 2, dirty: true }] } });

    const outcomes = await sut.run();

    assert.deepEqual(calls, [
      `start ${branch}`,
      "implement",
      "inspect",
      `test run ${branch}`,
      "review",
      "put back head-1",
      `close ${branch}`,
      `push ${branch}`,
      `open PR ${branch}`,
      "relabel #1: -ready-for-agent",
    ]);
    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(tracker.pushed, [branch]);
  });

  test("Fixable findings: the Implementer gets only them, then a Test run, then the wrap-up", async () => {
    const { sut, agents, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine] }] } });

    const outcomes = await sut.run();

    assert.deepEqual(calls, [
      `start ${branch}`,
      "implement",
      "inspect",
      `test run ${branch}`,
      "review",
      "put back head-1",
      "implement",
      "inspect",
      `test run ${branch}`,
      "wrap up",
      "put back head-3",
      `close ${branch}`,
      `push ${branch}`,
      `open PR ${branch}`,
      "relabel #1: -ready-for-agent",
    ]);
    assert.deepEqual(agents.feedback, [undefined, undefined]);
    assert.deepEqual(agents.fixing, [undefined, fixable]);
    assert.deepEqual(outcomes, [{ issue: 1, kind: "pull-request", branch, reviewLogs: ["logs/review-1", "logs/review-2"], platforms: [web], openFindings: [] }]);
  });

  test("a Fix round with no new commits has no Test run, and the wrap-up still runs", async () => {
    const { sut, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { fixableFindings: fixable }, { commits: 0 }] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(calls.slice(6, 10), ["implement", "inspect", "wrap up", "put back head-1"]);
    assert.equal(testRuns(calls), 1);
  });

  test("a failed Test run in the Fix round goes back to the Implementer with its log", async () => {
    const { sut, agents, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { fixableFindings: fixable }] }, testRunResults: [green, "error: fix"] });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(agents.feedback, [undefined, undefined, "error: fix"]);
    assert.deepEqual(agents.fixing, [undefined, fixable, fixable]);
    assert.deepEqual(agentRuns(calls), ["implement", "review", "implement", "implement", "wrap up"]);
    assert.equal(testRuns(calls), 3);
  });

  test("uncommitted changes in the Fix round are a failed Attempt", async () => {
    const { sut, agents, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { fixableFindings: fixable }, { dirty: true }] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(agents.feedback, [undefined, undefined, dirtyFeedback]);
    assert.equal(testRuns(calls), 2);
  });

  test("the Fix round spends the Attempt budget it shares with the first round", async () => {
    const { sut, agents, calls } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, {}, { fixableFindings: fixable }] },
      testRunResults: ["error: first round", green, "error: fix", "error: fix again"],
    });

    await sut.run();

    assert.deepEqual(agents.feedback, [undefined, "error: first round", undefined, "error: fix"]);
    assert.deepEqual(agents.fixing, [undefined, undefined, fixable, fixable]);
    assert.equal(testRuns(calls), 4);
  });

  test("the findings the Implementer left reach the wrap-up with its reasons", async () => {
    const left = "web/src/streak.ts:12: `x` is the name the issue asks for.";
    const { sut, agents } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { fixableFindings: fixable }, { commits: 0, findingsLeft: left }] } });

    await sut.run();

    assert.deepEqual(agents.wrapUps, [{ fixableFindings: fixable, openFindings: [], reviewedHead: "head-1", findingsLeft: left }]);
  });

  test("the findings left are those of the Fix round's last run", async () => {
    const { sut, agents } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable }, { findingsLeft: "Left at first." }, { findingsLeft: "Left at last." }] },
      testRunResults: [green, "error: fix"],
    });

    await sut.run();

    assert.deepEqual(agents.wrapUps.map((fixRound) => fixRound.findingsLeft), ["Left at last."]);
  });

  test("a later run of the Fix round that lists no finding left keeps the reasons of the run before", async () => {
    const { sut, agents } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{ findingsLeft: "Left before the review." }, { fixableFindings: fixable }, { findingsLeft: "Left at first." }, {}] },
      testRunResults: [green, "error: fix"],
    });

    await sut.run();

    assert.deepEqual(agents.wrapUps.map((fixRound) => fixRound.findingsLeft), ["Left at first."]);
  });

  test("a first round that lists a finding left gives the wrap-up none", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1)], runs: { 1: [{ findingsLeft: "Left before the review." }, { fixableFindings: fixable }] } });

    await sut.run();

    assert.deepEqual(agents.wrapUps, [{ fixableFindings: fixable, openFindings: [], reviewedHead: "head-1" }]);
  });

  test("a Fixable finding left unfixed is posted as an Open finding", async () => {
    const leftOpen: OpenFinding = { text: "`x` says nothing. The Implementer left it: `x` is the name the issue asks for.", at: { path: "web/src/streak.ts", line: 12 } };
    const { sut, tracker } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable }, { commits: 0, findingsLeft: "`x` is the name the issue asks for." }, { openFindings: [leftOpen] }] },
    });

    await sut.run();

    assert.deepEqual(tracker.reviews.map((review) => review.comments.map((comment) => comment.body)), [[`<!-- afk-loop -->\n**The AFK loop's Reviewer:**\n\n${leftOpen.text}`]]);
  });

  test("Attempt budget spent in the Fix round is no Handoff: the branch goes back to the first round's green commit, the wrap-up runs on it and the PR opens", async () => {
    const { sut, agents, tracker, calls } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine] }, {}, { dirty: true }, { platforms: [web, server], findingsLeft: "None." }, { openFindings: [onLine, noLine] }] },
      testRunResults: [green, "error: fix", "error: fix again"],
    });

    const outcomes = await sut.run();

    assert.deepEqual(calls.slice(5), [
      "put back head-1",
      "implement",
      "inspect",
      `test run ${branch}`,
      "implement",
      "inspect",
      "implement",
      "inspect",
      `test run ${branch}`,
      "put back head-1",
      "wrap up",
      "put back head-1",
      `close ${branch}`,
      `push ${branch}`,
      `open PR ${branch}`,
      "relabel #1: -ready-for-agent",
      `post review https://pr/${branch}`,
    ]);
    assert.deepEqual(agents.wrapUps, [{ fixableFindings: fixable, openFindings: [onLine], reviewedHead: "head-1", findingsLeft: "None.", failed: true }]);
    assert.deepEqual(outcomes, [
      { issue: 1, kind: "pull-request", branch, reviewLogs: ["logs/review-1", "logs/review-2"], platforms: [web], openFindings: [onLine, noLine], fixRoundFailed: true },
    ]);
    assert.deepEqual(tracker.comments, []);
    assert.equal(tracker.reviews.length, 1);
  });

  test("after a failed Fix round the PR body's Host lines say so, and that its fixes are not included", async () => {
    const { sut, tracker } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable }, {}, {}, {}, { openFindings: [noLine], pullRequestDraft: "## Summary\n\nGreen work." }] },
      testRunResults: [green, "error: fix", "error: fix", "error: fix"],
    });

    await sut.run();

    assert.match(
      tracker.pullRequests[0]?.body ?? "",
      /^Closes #1\.\n\n## Summary\n\nGreen work\.\n\nImplemented by[^\n]*\n\nReviewed by[^\n]*It posted 1 Open finding as review comments on this PR\.\n\nThe Fix round failed its Test run, so its fixes are not included: the Reviewer's Fixable findings are among the Open findings\.\n\nVerified: the Test run passed on the reviewed commit \(the web tests\)\.$/,
    );
  });

  test("a Fix round that ends green says nothing of a failure in the PR body", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { fixableFindings: fixable }] }, testRunResults: [green, "error: fix"] });

    await sut.run();

    assert.ok(!(tracker.pullRequests[0]?.body ?? "").includes("Fix round"));
  });

  test("a Handoff comes only from the first round: budget spent before any green Test run", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [issue(1)], testRunResults: ["error: one", "error: two", "error: three"] });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 1, kind: "handoff", branch, reason: "attempt-budget", log: "error: three", rawLog: `raw/${branch}` }]);
    assert.ok(!calls.includes("review"));
    assert.deepEqual(tracker.pullRequests, []);
  });

  test("the wrap-up gets run 1's Fixable and Open findings and the commit it reviewed", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine, noLine] }] } });

    await sut.run();

    assert.deepEqual(agents.wrapUps, [{ fixableFindings: fixable, openFindings: [onLine, noLine], reviewedHead: "head-1" }]);
  });

  test("only the last Reviewer run's Open findings are posted and counted", async () => {
    const { sut, tracker } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine, noLine] }, {}, { openFindings: [noLine] }] },
    });

    await sut.run();

    assert.deepEqual(tracker.reviews.map((review) => [review.body.includes("skipped day"), review.comments.length]), [[true, 0]]);
    assert.match(tracker.pullRequests[0]?.body ?? "", /Its logs on the Host: `logs\/review-1`, `logs\/review-2`\. It posted 1 Open finding /);
  });

  test("a wrap-up that gives no Open findings block: the Host posts run 1's Open findings and the Fixable findings as unchecked, and the PR body counts them", async () => {
    const { sut, tracker } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine, noLine] }, {}, { noOpenFindingsBlock: true }] },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes.map((outcome) => outcome.kind === "pull-request" && outcome.openFindings), [[onLine, noLine, { text: `${unchecked}\n\n${fixable}` }]]);
    assert.deepEqual(tracker.reviews.map((review) => [review.body, review.comments.length]), [[`${reviewerSays}\n\n- No test covers a skipped day.\n- ${unchecked}\n  \n  ${fixable}`, 1]]);
    assert.match(tracker.pullRequests[0]?.body ?? "", /It posted 3 Open findings as review comments on this PR\./);
  });

  test("a wrap-up that gives no Open findings block after a failed Fix round: the Host also posts the Fixable findings, as one finding in the review's body", async () => {
    const { sut, tracker } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine] }, {}, {}, {}, { noOpenFindingsBlock: true }] },
      testRunResults: [green, "error: fix", "error: fix", "error: fix"],
    });

    await sut.run();

    assert.deepEqual(tracker.reviews.map((review) => [review.body, review.comments.length]), [[`${reviewerSays}\n\n- ${unfixed}`, 1]]);
    assert.match(tracker.pullRequests[0]?.body ?? "", /It posted 2 Open findings as review comments on this PR\./);
  });

  test("a wrap-up that gives an empty Open findings block after a failed Fix round: the Host posts run 1's Open findings and the Fixable findings all the same", async () => {
    const { sut, tracker } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine] }, {}, {}, {}, { openFindings: [] }] },
      testRunResults: [green, "error: fix", "error: fix", "error: fix"],
    });

    await sut.run();

    assert.deepEqual(tracker.reviews.map((review) => [review.body, review.comments.length]), [[`${reviewerSays}\n\n- ${unfixed}`, 1]]);
    assert.match(tracker.pullRequests[0]?.body ?? "", /It posted 2 Open findings as review comments on this PR\./);
  });

  test("a wrap-up after a failed Fix round that gives no more findings than run 1's Open findings: the Host adds the Fixable findings", async () => {
    const restated: OpenFinding = { text: "The streak still resets at UTC midnight.", at: { path: "web/src/streak.ts", line: 12 } };
    const { sut } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine] }, {}, {}, {}, { openFindings: [restated] }] },
      testRunResults: [green, "error: fix", "error: fix", "error: fix"],
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes.map((outcome) => outcome.kind === "pull-request" && outcome.openFindings), [[restated, { text: `The Fix round failed, so none of these Fixable findings is fixed:\n\n${fixable}` }]]);
  });

  test("a wrap-up that gives an empty Open findings block after a green Fix round has no Open finding", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { fixableFindings: fixable, openFindings: [onLine] }, {}, { openFindings: [] }] } });

    await sut.run();

    assert.deepEqual(tracker.reviews, []);
    assert.match(tracker.pullRequests[0]?.body ?? "", /It left no Open finding\./);
  });

  test("the wrap-up's findings never start a second Fix round", async () => {
    const { sut, calls } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { fixableFindings: fixable }, {}, { fixableFindings: "One more.", openFindings: [noLine] }] },
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(agentRuns(calls), ["implement", "review", "implement", "wrap up"]);
  });
});

describe("runAfkLoop, routing", () => {
  test("the Test run covers the platforms the branch changes, and the PR says what was verified", async () => {
    const { sut, tracker, testRunner } = makeSUT({ issues: [issue(1)], runs: { 1: [{ platforms: [server] }, { platforms: [web, server] }] }, testRunResults: ["error: boom"] });

    const outcomes = await sut.run();

    assert.deepEqual(testRunner.platforms, [[server], [web, server]]);
    assert.deepEqual(outcomes.map((o) => o.kind === "pull-request" && o.platforms), [[web, server]]);
    assert.match(tracker.pullRequests[0]?.body ?? "", /\n\nVerified: the Test run passed on the reviewed commit \(the web tests; the server tests\)\.$/);
  });

  test("a branch changing neither platform is reviewed and opens its PR without a Test run", async () => {
    const neither = { platforms: [] };
    const { sut, tracker, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [neither, neither] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(calls.slice(1, 5), ["implement", "inspect", "review", "put back head-1"]);
    assert.equal(testRuns(calls), 0);
    assert.match(tracker.pullRequests[0]?.body ?? "", /\n\nNo Test run: the branch changes neither `web\/` nor `server\/`\.$/);
  });
});

describe("runAfkLoop, Acceptance criteria", () => {
  test("an issue with no Acceptance criteria section is a Handoff naming the section, with no Sandbox and no Attempt, and the loop moves on", async () => {
    const { sut, agents, tracker, calls } = makeSUT({ issues: [issue(1, { body: "Count the streak.\n\n## Blocked by\n\nNone" }), issue(2)] });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes[0], { issue: 1, kind: "handoff", reason: "no-acceptance-criteria", missing: "section" });
    assert.deepEqual(calls.slice(0, 2), ["relabel #1: -ready-for-agent +ready-for-human", "comment on #1"]);
    assert.deepEqual(tracker.comments, [
      [
        "<!-- afk-loop -->\nHanded off to a human: the issue has no `## Acceptance criteria` section.",
        "The loop works an issue only when its `## Acceptance criteria` section has at least one item. No Sandbox was opened and no Attempt was spent.",
        "To requeue for the loop: add a `## Acceptance criteria` section with at least one item to this issue, then relabel the issue `ready-for-agent`.",
      ].join("\n\n"),
    ]);
    assert.deepEqual(agents.startedIssues, [2]);
  });

  test("an issue whose Acceptance criteria section has no items is the same Handoff, naming the empty section", async () => {
    const { sut, agents, tracker } = makeSUT({ issues: [issue(1, { body: "## Acceptance criteria\n\n- [ ]\n\nTBD\n\n## Blocked by\n\n- #2" })] });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 1, kind: "handoff", reason: "no-acceptance-criteria", missing: "items" }]);
    assert.match(tracker.comments[0] ?? "", /^<!-- afk-loop -->\nHanded off to a human: the issue's `## Acceptance criteria` section has no items\.\n\n/);
    assert.deepEqual(agents.startedIssues, []);
  });

  test("an issue with one Acceptance criteria item, under any heading level after it, is worked", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1, { body: "## Acceptance criteria\n\n### Streak\n\n1. The streak counts the day\n\n## Notes" })] });

    await sut.run();

    assert.deepEqual(agents.startedIssues, [1]);
  });
});

describe("runAfkLoop, Behavior check", () => {
  const check = (fixture: Partial<Fixture> = {}) => makeSUT({ issues: [issue(1)], platforms: [web, ios], runs: { 1: [{ platforms: [ios] }] }, ...fixture });
  const prBody = (tracker: SpyTracker) => tracker.pullRequests[0]?.body ?? "";
  const by = "by the AFK loop's Verifier in the Sandbox with `verify-ios`. Its log on the Host: `logs/issue-1-verifier-1`. Its Behavior evidence on the Host: `.sandcastle/evidence/1-head-1/`.";

  test("the Verifier runs once after the Reviewer's last run, at the final head, and the PR shows its PASS under the Verified line", async () => {
    const { sut, tracker, calls } = check();

    await sut.run();

    assert.deepEqual(calls.slice(0, 8), ["start issue/1-issue-1", "implement", "inspect", "test run issue/1-issue-1", "review", "put back head-1", "verify verify-ios at head-1", "close issue/1-issue-1"]);
    assert.ok(
      prBody(tracker).endsWith(
        [
          "Verified: the Test run passed on the reviewed commit (the ios tests).",
          `Behavior check: PASS on \`head-1\`, ${by}`,
          "- **Met**: The streak counts the day\n  The streak read 1 day.\n  .sandcastle/evidence/1-head-1/streak.png",
        ].join("\n\n"),
      ),
    );
    assert.deepEqual(tracker.pullRequests[0]?.attached, [".sandcastle/evidence/1-head-1/streak.png"]);
  });

  test("after a Fix round the Verifier runs once, after the wrap-up, at the head it reviewed", async () => {
    const { sut, calls } = check({ runs: { 1: [{ platforms: [ios] }, { fixableFindings: "Rename it." }, { platforms: [ios] }, { commits: 0 }] } });

    await sut.run();

    assert.deepEqual(calls.filter((call) => /^(implement|review|wrap up|verify)/.test(call)), ["implement", "review", "implement", "wrap up", "verify verify-ios at head-3"]);
  });

  test("a FAIL shows each claim line, the Not checked list and the video, starts no Fix round and spends no Attempt", async () => {
    const failing = manifest("head-1", {
      outcome: "FAIL",
      reason: "The streak stays at 0 days.",
      claims: [
        { ...metClaim, result: "not met", observed: "The streak read 0 days." },
        { kind: "regression", criterion: "Today: check off Meditate", result: "met", observed: "All 1 marked.", screenshots: ["check-off.png", "streak.png"], feature: "today.md" },
        { kind: "criterion", criterion: "The streak shows a flame", result: "met", observed: "A flame by the count.", screenshots: ["flame.png"], feature: null },
      ],
      skipped: [
        { kind: "criterion", criterion: "StreakStore has unit tests.", why: "not observable in the app" },
        { kind: "regression", criterion: "Today: the streak starts at 1", why: "changed by this issue: feature file out of date", feature: "today.md" },
      ],
      video: "drive.mp4",
    });
    const files = ["streak.png", "check-off.png", "flame.png", "drive.mp4"].map((name) => ({ name, bytes: 1 }));
    const { sut, tracker, calls } = check({ verifier: () => ({ manifest: failing, files }) });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(calls.filter((call) => /^(implement|review|wrap up|verify|test run)/.test(call)), ["implement", "test run issue/1-issue-1", "review", "verify verify-ios at head-1"]);
    assert.ok(
      prBody(tracker).endsWith(
        [
          `Behavior check: FAIL on \`head-1\`: The streak stays at 0 days, ${by}`,
          [
            "- **Not met**: The streak counts the day\n  The streak read 0 days.\n  .sandcastle/evidence/1-head-1/streak.png",
            "- **Met**, regression (`today.md`): Today: check off Meditate\n  All 1 marked.\n  .sandcastle/evidence/1-head-1/check-off.png\n  .sandcastle/evidence/1-head-1/streak.png",
            "- **Met**, no feature file, driven with the Drive commands: The streak shows a flame\n  A flame by the count.\n  .sandcastle/evidence/1-head-1/flame.png",
          ].join("\n"),
          "Not checked:\n- StreakStore has unit tests: not observable in the app.\n- Today: the streak starts at 1 (`today.md`): changed by this issue: feature file out of date.",
          "Video of the drive: .sandcastle/evidence/1-head-1/drive.mp4",
        ].join("\n\n"),
      ),
    );
    assert.deepEqual(
      tracker.pullRequests[0]?.attached,
      ["streak.png", "check-off.png", "flame.png", "drive.mp4"].map((file) => `.sandcastle/evidence/1-head-1/${file}`),
    );
  });

  test("an INCONCLUSIVE gives the Verifier's reason and asks for a check by hand", async () => {
    const unchecked = manifest("head-1", { outcome: "INCONCLUSIVE", reason: "Doctor: app_running false after Launch.", claims: [], skipped: [] });
    const { sut, tracker } = check({ verifier: () => ({ manifest: unchecked, files: [] }) });

    await sut.run();

    assert.ok(prBody(tracker).endsWith(`Behavior check: INCONCLUSIVE on \`head-1\`: Doctor: app_running false after Launch. Check the app by hand before merging, ${by}`));
  });

  for (const [what, verifier, reason] of [
    ["a missing manifest", () => ({ manifest: undefined }), "no Evidence manifest"],
    ["an unreadable manifest", () => ({ manifest: "{ not json" }), "Evidence manifest unreadable"],
    ["a manifest of the wrong shape", () => ({ manifest: JSON.stringify({ outcome: "PASS", head: "head-1" }) }), "Evidence manifest unreadable"],
    ["a manifest for another head", () => ({ manifest: manifest("0ab12cdef") }), "Evidence manifest is for 0ab12cd, not head-1"],
    ["a listed file that is missing", () => ({ files: [] }), "listed file streak.png not in ~/afk-evidence"],
    ["a listed file with a / in its name", () => ({ manifest: manifest("head-1", { claims: [{ ...metClaim, screenshots: ["shots/streak.png"] }] }), files: [{ name: "shots/streak.png", bytes: 1 }] }), "listed file shots/streak.png not in ~/afk-evidence"],
  ] as const) {
    test(`${what} gives INCONCLUSIVE with that reason, no claims and no attachment`, async () => {
      const { sut, tracker } = check({ verifier });

      await sut.run();

      assert.ok(prBody(tracker).endsWith(`Behavior check: INCONCLUSIVE on \`head-1\`: ${reason}. Check the app by hand before merging, ${by}`));
      assert.deepEqual(tracker.pullRequests[0]?.attached, []);
    });
  }

  test("a manifest outcome that disagrees with its claims gives INCONCLUSIVE naming both, with the claims shown", async () => {
    const { sut, tracker } = check({ verifier: (head) => ({ manifest: manifest(head, { claims: [{ ...metClaim, result: "unchecked", screenshots: [] }] }) }) });

    await sut.run();

    assert.ok(
      prBody(tracker).endsWith(
        [
          `Behavior check: INCONCLUSIVE on \`head-1\`: Evidence manifest says PASS, its claims say INCONCLUSIVE. Check the app by hand before merging, ${by}`,
          "- **Unchecked**: The streak counts the day\n  The streak read 1 day.",
        ].join("\n\n"),
      ),
    );
  });

  test("a video over 10 MB is not attached, and the PR gives its size and Host path", async () => {
    const files = [{ name: "streak.png", bytes: 2048 }, { name: "drive.mp4", bytes: 14_680_064 }];
    const { sut, tracker } = check({ verifier: (head) => ({ manifest: manifest(head, { video: "drive.mp4" }), files }) });

    await sut.run();

    assert.ok(prBody(tracker).endsWith("\n\nVideo dropped: 14.0 MB, over the 10 MB cap. On the Host: .sandcastle/evidence/1-head-1/drive.mp4."));
    assert.deepEqual(tracker.pullRequests[0]?.attached, [".sandcastle/evidence/1-head-1/streak.png"]);
  });

  test("a video of 10 MB is attached", async () => {
    const files = [{ name: "streak.png", bytes: 2048 }, { name: "drive.mp4", bytes: 10_485_760 }];
    const { sut, tracker } = check({ verifier: (head) => ({ manifest: manifest(head, { video: "drive.mp4" }), files }) });

    await sut.run();

    assert.ok(prBody(tracker).endsWith("\n\nVideo of the drive: .sandcastle/evidence/1-head-1/drive.mp4"));
    assert.deepEqual(tracker.pullRequests[0]?.attached, [".sandcastle/evidence/1-head-1/streak.png", ".sandcastle/evidence/1-head-1/drive.mp4"]);
  });

  test("an upload that fails still opens the PR, with the gh error, the Host path, and file names in the claims", async () => {
    const files = [{ name: "streak.png", bytes: 2048 }, { name: "drive.mp4", bytes: 2048 }];
    const { sut, tracker } = check({ verifier: (head) => ({ manifest: manifest(head, { video: "drive.mp4" }), files }), attachFails: "HTTP 422: Unprocessable Entity" });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.ok(
      prBody(tracker).endsWith(
        [
          `Behavior check: PASS on \`head-1\`, ${by}`,
          "Behavior evidence could not be attached (HTTP 422: Unprocessable Entity). It is on the Host at .sandcastle/evidence/1-head-1/: attach it before merging.",
          "- **Met**: The streak counts the day\n  The streak read 1 day.\n  `streak.png`",
          "Video of the drive: `drive.mp4`",
        ].join("\n\n"),
      ),
    );
    assert.deepEqual(tracker.pullRequests[0]?.attached, []);
  });

  for (const [what, verifier] of [
    ["a dirty tree", () => ({ dirty: true })],
    ["a moved HEAD", () => ({ head: "head-9" })],
  ] as const) {
    test(`${what} after the Verifier puts the branch back at the final head, and the outcome is INCONCLUSIVE`, async () => {
      const { sut, tracker, calls } = check({ verifier });

      await sut.run();

      assert.deepEqual(calls.slice(6, 9), ["verify verify-ios at head-1", "put back head-1", "close issue/1-issue-1"]);
      assert.ok(prBody(tracker).endsWith(`Behavior check: INCONCLUSIVE on \`head-1\`: the Verifier changed the branch. Check the app by hand before merging, ${by}`));
      assert.deepEqual(tracker.pullRequests[0]?.attached, []);
    });
  }

  test("a branch that changes no Platform with a Verify skill gets no Verifier, and the PR says so", async () => {
    const { sut, tracker, calls } = check({ runs: { 1: [{ platforms: [web] }] } });

    const outcomes = await sut.run();

    assert.ok(!calls.some((call) => call.startsWith("verify")));
    assert.ok(outcomes[0]?.kind === "pull-request" && !outcomes[0].behaviorCheck);
    assert.ok(prBody(tracker).endsWith("Verified: the Test run passed on the reviewed commit (the web tests).\n\nNo Behavior check: the branch changes no Platform with a Verify skill."));
  });

  test("the first Platform with a Verify skill is the one checked", async () => {
    const android: Platform = { ...platform("android"), verifySkill: "verify-android" };
    const { sut, calls } = check({ platforms: [web, android, ios], runs: { 1: [{ platforms: [web, android, ios] }] } });

    await sut.run();

    assert.ok(calls.includes("verify verify-android at head-1"));
  });
});

describe("runAfkLoop, blocked issues", () => {
  test("a blocked issue stays blocked behind the open PR", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1), issue(2, { openBlockers: 1 })] });

    await sut.run();

    assert.deepEqual(agents.startedIssues, [1]);
  });
});

// MARK: - Helpers

interface Fixture {
  issues: Issue[];
  issuesWithOpenPullRequest?: number[];
  pushedBranches?: string[];
  localBranches?: Record<number, LocalBranch[]>;
  runs?: Record<number, Run[]>;
  testRunResults?: (string | null)[];
  pushFails?: boolean;
  attachFails?: string;
  rejectedReviews?: number;
  linkedIssues?: LinkedIssue[];
  comments?: Record<number, string[] | "unreadable">;
  platforms?: Platform[];
  verifier?: (head: string) => Partial<VerifierRun>;
}

interface Run {
  commits?: number;
  movesHead?: boolean;
  dirty?: boolean;
  platforms?: Platform[];
  fixableFindings?: string;
  openFindings?: OpenFinding[];
  pullRequestDraft?: string;
  reply?: string;
  findingsLeft?: string;
  contradiction?: string;
  noOpenFindingsBlock?: true;
  unreadable?: true;
}

function makeSUT(fixture: Fixture) {
  const calls: string[] = [];
  const tracker = new SpyTracker(fixture, calls);
  const agents = new SpyAgents(fixture, calls);
  const testRunner = new SpyTestRunner(fixture.testRunResults ?? [], calls);
  const sut = { run: (cap?: number) => runAfkLoop({ tracker, agents, testRunner, cap, platforms: fixture.platforms ?? [web, server] }) };
  return { sut, tracker, agents, testRunner, calls };
}

const green = null;

function platform(name: string): Platform {
  return { name, folder: name, standards: "", agentBuildHint: "", verified: `the ${name} tests`, steps: async () => [] };
}

const web = platform("web");
const server = platform("server");
const ios: Platform = { ...platform("ios"), verifySkill: "verify-ios" };

const metClaim: Claim = { kind: "criterion", criterion: "The streak counts the day", result: "met", observed: "The streak read 1 day.", screenshots: ["streak.png"], feature: "streak.md" };

function manifest(head: string, overrides: Partial<Manifest> = {}): string {
  return JSON.stringify({ outcome: "PASS", head, claims: [metClaim], skipped: [], ...overrides });
}

function passing(head: string): VerifierRun {
  return { log: "logs/issue-1-verifier-1", evidence: `.sandcastle/evidence/1-${head}/`, manifest: manifest(head), files: [{ name: "streak.png", bytes: 2048 }], head, dirty: false };
}

function testRuns(calls: string[]): number {
  return calls.filter((call) => call.startsWith("test run")).length;
}

function linked(number: number): LinkedIssue {
  return { number, title: `Issue ${number}`, body: "", comments: [] };
}

const criteria = "## Acceptance criteria\n\n- [ ] The streak counts the day";

function issue(number: number, overrides: Partial<Issue> = {}): Issue {
  return { number, title: `Issue ${number}`, body: criteria, labels: ["ready-for-agent"], openBlockers: 0, ...overrides };
}

class SpyTracker implements Tracker {
  issues: Issue[];
  pushedBranches: string[];
  pushed: string[] = [];
  pullRequests: (PullRequest & { attached: readonly string[] })[] = [];
  reviews: PullRequestReview[] = [];
  comments: string[] = [];

  constructor(
    private readonly fixture: Fixture,
    private readonly calls: string[],
  ) {
    this.issues = fixture.issues;
    this.pushedBranches = [...(fixture.pushedBranches ?? [])];
  }

  async issueComments(issueNumber: number) {
    const comments = this.fixture.comments?.[issueNumber] ?? [];
    if (comments === "unreadable") throw new Error("comments unreadable");
    return comments;
  }

  async linkedIssues(numbers: readonly number[]) {
    return (this.fixture.linkedIssues ?? []).filter((linked) => numbers.includes(linked.number));
  }

  async backlog(): Promise<Backlog> {
    return {
      issues: this.issues,
      issuesWithOpenPullRequest: this.fixture.issuesWithOpenPullRequest ?? [],
      pushedBranches: this.pushedBranches,
    };
  }

  async pushBranch(branch: string) {
    if (this.fixture.pushFails) throw new Error("push rejected");
    this.calls.push(`push ${branch}`);
    this.pushed.push(branch);
    this.pushedBranches.push(branch);
  }

  async openPullRequest(pullRequest: PullRequest) {
    this.calls.push(`open PR ${pullRequest.branch}`);
    const { attachments, ...opened } = pullRequest;
    const { attachFails } = this.fixture;
    if (attachments && attachFails) this.pullRequests.push({ ...opened, body: attachments.unattached(attachFails), attached: [] });
    else this.pullRequests.push({ ...opened, attached: attachments?.files ?? [] });
    return `https://pr/${pullRequest.branch}`;
  }

  async postReview(pullRequest: string, review: PullRequestReview) {
    this.calls.push(`post review ${pullRequest}`);
    this.reviews.push(review);
    if (this.reviews.length <= (this.fixture.rejectedReviews ?? 0)) throw new Error("review rejected");
  }

  async comment(issueNumber: number, body: string) {
    this.calls.push(`comment on #${issueNumber}`);
    this.comments.push(body);
  }

  async relabel(issueNumber: number, { remove, add }: Relabel) {
    this.calls.push(`relabel #${issueNumber}: -${remove}${add ? ` +${add}` : ""}`);
    this.issues = this.issues.map((i) =>
      i.number === issueNumber ? { ...i, labels: [...i.labels.filter((l) => l !== remove), ...(add ? [add] : [])] } : i,
    );
  }
}

class SpyAgents implements Agents {
  startedIssues: number[] = [];
  started: Issue[] = [];
  feedback: (string | undefined)[] = [];
  fixing: (string | undefined)[] = [];
  wrapUps: FixRound[] = [];
  sandboxes: SandboxExec[] = [];

  constructor(
    private readonly fixture: Fixture,
    private readonly calls: string[],
  ) {}

  async localBranches(issueNumber: number) {
    return this.fixture.localBranches?.[issueNumber] ?? [];
  }

  async discardLeftover(branch: string) {
    this.calls.push(`discard ${branch}`);
  }

  private openSandbox(): SandboxExec {
    const sandbox: SandboxExec = async () => ({ exitCode: 0, output: "" });
    this.sandboxes.push(sandbox);
    return sandbox;
  }

  async start(issue: Issue, branch: string): Promise<IssueSession> {
    this.calls.push(`start ${branch}`);
    this.startedIssues.push(issue.number);
    this.started.push(issue);
    const runs = this.fixture.runs?.[issue.number] ?? [];
    let runIndex = -1;
    let commitsAhead = 0;
    let heads = 0;
    let head = "head-0";
    let reviewerRuns = 0;
    const commitsAheadAt = new Map<string, number>();
    const run = (): Run => runs[runIndex] ?? {};
    const agentRun = () => {
      runIndex += 1;
      const commits = run().commits ?? 1;
      commitsAhead += commits;
      if (commits !== 0 || run().movesHead) head = `head-${(heads += 1)}`;
    };
    const reviewerRun = () => {
      agentRun();
      const { fixableFindings, openFindings = [], pullRequestDraft } = run();
      return { log: `logs/review-${(reviewerRuns += 1)}`, fixableFindings, openFindings, pullRequestDraft };
    };
    return {
      exec: this.openSandbox(),
      implement: async (feedback, fixableFindings) => {
        this.calls.push("implement");
        this.feedback.push(feedback);
        this.fixing.push(fixableFindings);
        agentRun();
        const { reply = "", findingsLeft, contradiction } = run();
        return { reply, log: `logs/implementer-${this.feedback.length}`, ...(findingsLeft ? { findingsLeft } : {}), ...(contradiction ? { contradiction } : {}) };
      },
      review: async () => {
        this.calls.push("review");
        return { ...reviewerRun(), ...(run().unreadable ? { unreadable: true as const } : {}) };
      },
      wrapUp: async (fixRound) => {
        this.calls.push("wrap up");
        this.wrapUps.push(fixRound);
        const { log, openFindings, pullRequestDraft } = reviewerRun();
        return { log, pullRequestDraft, ...(run().noOpenFindingsBlock ? {} : { openFindings }) };
      },
      putBack: async (tested) => {
        this.calls.push(`put back ${tested}`);
        head = tested;
        commitsAhead = commitsAheadAt.get(tested) ?? 0;
      },
      inspect: async () => {
        this.calls.push("inspect");
        commitsAheadAt.set(head, commitsAhead);
        return { dirty: run().dirty ?? false, head, commitsAhead, platforms: run().platforms ?? [web] };
      },
      verify: async (verifySkill, finalHead) => {
        this.calls.push(`verify ${verifySkill} at ${finalHead}`);
        return { ...passing(finalHead), ...this.fixture.verifier?.(finalHead) };
      },
      close: async () => {
        this.calls.push(`close ${branch}`);
      },
    };
  }
}

class SpyTestRunner implements TestRunner {
  sandboxes: SandboxExec[] = [];
  platforms: (readonly Platform[])[] = [];

  constructor(
    private readonly results: (string | null)[],
    private readonly calls: string[],
  ) {}

  async run(sandbox: SandboxExec, branch: string, platforms: readonly Platform[]) {
    this.sandboxes.push(sandbox);
    this.platforms.push(platforms);
    this.calls.push(`test run ${branch}`);
    const log = this.results.shift();
    return log ? { passed: false, log } : { passed: true, log: "" };
  }

  rawLogPath(branch: string) {
    return `raw/${branch}`;
  }
}
