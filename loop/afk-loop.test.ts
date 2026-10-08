import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  runAfkLoop,
  type Agents,
  type Backlog,
  type Issue,
  type IssueSession,
  type LinkedIssue,
  type LocalBranch,
  type PullRequest,
  type NumberedComment,
  type Relabel,
  type ReviewComment,
  type RevisionPullRequest,
  type RevisionStart,
  type SandboxExec,
  type TestRunner,
  type Tracker,
} from "./afk-loop.js";
import { dirtyFeedback } from "./loop-rules.js";
import type { Platform } from "./platforms.js";
import { fixedWithoutCommitFeedback } from "./revision.js";

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
    const { sut, agents } = makeSUT({ issues: [issue(1, { body: "Start from #224.\n\n## Blocked by\n\n- #229" })], linkedIssues: [verified, { ...verified, number: 229 }] });

    await sut.run();

    assert.deepEqual(agents.started[0]?.linkedIssues, [verified]);
  });

  test("a green Attempt is reviewed and re-tested, then pushed as a ready-for-human PR closing the issue", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [issue(12, { title: "[#9] - AFK loop tracer: pick issue → PR" })] });
    const branch = "issue/12-afk-loop-tracer-pick";

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 12, kind: "pull-request", branch, reviewLogs: ["logs/review-1"], platforms: [web], openFindings: false }]);
    assert.deepEqual(calls, [
      `start ${branch}`,
      "implement",
      "inspect",
      `test run ${branch}`,
      "review",
      "inspect",
      `test run ${branch}`,
      `close ${branch}`,
      `push ${branch}`,
      `open PR ${branch}`,
      "relabel #12: -ready-for-agent",
    ]);
    assert.equal(tracker.pullRequests[0]?.title, "[#12] - AFK loop tracer: pick issue → PR");
    assert.equal(tracker.pullRequests[0]?.label, "ready-for-human");
    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #12\.[\s\S]*Reviewer[\s\S]*`logs\/review-1`\. It left no finding unfixed\.\n/);
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
        "Handed off to a human: the Implementer made no commits.",
        "The Implementer's last reply (its log on the Host: `logs/implementer-1`):\n\n```text\nIssue 1 is already done.\n```",
        "The branch `issue/1-issue-1` and its worktree stay on the Host; nothing is pushed.",
        "To requeue for the loop: remove the local `issue/1-issue-1` branch and its worktree, relabel the issue `ready-for-agent`.",
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

    assert.deepEqual(outcomes, [{ issue: 1, kind: "pull-request", branch: "issue/1-issue-1", reviewLogs: ["logs/review-1"], platforms: [web], openFindings: false }]);
    assert.deepEqual(agents.feedback, [undefined, "error: boom"]);
    assert.equal(testRuns(calls), 3);
  });

  test("a dirty worktree is a failed Attempt that asks for a commit and skips the Test run", async () => {
    const { sut, agents, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{ dirty: true }, {}] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.equal(agents.feedback[1], dirtyFeedback);
    assert.equal(testRuns(calls), 2);
  });

  test("a Reviewer with no new commits opens the PR without another Test run", async () => {
    const { sut, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { commits: 0 }] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.equal(testRuns(calls), 1);
  });

  test("a Reviewer that breaks the Test run gets its log, and its failures spend the shared Attempt budget", async () => {
    const { sut, agents, calls } = makeSUT({
      issues: [issue(1)],
      testRunResults: ["error: implementer", green, "error: reviewer", "error: reviewer again"],
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "handoff");
    assert.deepEqual(agents.feedback, [undefined, "error: implementer"]);
    assert.deepEqual(agents.reviewFeedback, [undefined, "error: reviewer"]);
    assert.equal(testRuns(calls), 4);
  });

  test("a Reviewer that fixes its own breakage opens the PR", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1)], testRunResults: [green, "error: reviewer"] });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(agents.reviewFeedback, [undefined, "error: reviewer"]);
  });

  test("an Attempt budget spent in review hands off with the last green commit", async () => {
    const { sut, tracker, agents } = makeSUT({ issues: [issue(1)], testRunResults: [green, "error: one", "error: two", "error: three"] });
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
        lastGreenHead: "head-1",
      },
    ]);
    assert.equal(agents.reviewFeedback.length, 3);
    assert.match(tracker.comments[0] ?? "", /in review[\s\S]*last green at `head-1`[\s\S]*error: three/);
    assert.deepEqual(tracker.pushed, []);
    assert.deepEqual(tracker.pullRequests, []);
  });

  test("an Attempt budget spent on a dirty Reviewer hands off without the Implementer's fixed failure", async () => {
    const { sut } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, {}, { dirty: true }, { dirty: true }] },
      testRunResults: ["error: implementer"],
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [
      {
        issue: 1,
        kind: "handoff",
        branch: "issue/1-issue-1",
        reason: "attempt-budget",
        log: dirtyFeedback,
        lastGreenHead: "head-2",
      },
    ]);
  });

  test("a Reviewer that removes the branch's commits is pointed at the last green commit", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { commits: -1 }, {}] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.match(agents.reviewFeedback[1] ?? "", /removed the branch's commits[\s\S]*head-1/);
  });

  test("an Attempt budget spent by a Reviewer removing the branch's commits hands off unpushed, naming the last green commit", async () => {
    const { sut, tracker, agents } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, { commits: -1 }, { commits: 0 }, { commits: 0 }] },
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "handoff");
    assert.equal(agents.reviewFeedback.length, 3);
    assert.deepEqual(tracker.pushed, []);
    assert.match(tracker.comments[0] ?? "", /last green at `head-1`/);
    assert.doesNotMatch(tracker.comments[0] ?? "", /Test run output filtered/);
  });

  test("a Reviewer leaving a dirty worktree is asked for a commit before any Test run", async () => {
    const { sut, agents, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { dirty: true }, {}] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(agents.reviewFeedback, [undefined, dirtyFeedback]);
    assert.equal(testRuns(calls), 2);
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
        "Handed off to a human: the Attempt budget (3) ran out without a green Test run.",
        "Feedback from the last Attempt (Test run output filtered; raw log on the Host: `raw/issue/1-issue-1`):\n\n```text\nerror: three\n```",
        "The branch `issue/1-issue-1` and its worktree stay on the Host; nothing is pushed.",
        "To requeue for the loop: remove the local `issue/1-issue-1` branch and its worktree, relabel the issue `ready-for-agent`.",
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
        "Handed off to a human: the Attempt budget (3) ran out without a green Test run.",
        `Feedback from the last Attempt:\n\n\`\`\`text\n${dirtyFeedback}\n\`\`\``,
        "The branch `issue/1-issue-1` and its worktree stay on the Host; nothing is pushed.",
        "To requeue for the loop: remove the local `issue/1-issue-1` branch and its worktree, relabel the issue `ready-for-agent`.",
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
    assert.equal(testRuns(calls), 3);
  });

  test("the Test run executes in the issue's Sandbox", async () => {
    const { sut, agents, testRunner } = makeSUT({ issues: [issue(1)] });

    await sut.run();

    assert.deepEqual(testRunner.sandboxes, [agents.sandboxes[0], agents.sandboxes[0]]);
  });

  test("a Revision's Test run executes in its Sandbox", async () => {
    const { sut, agents, testRunner } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
    });

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

describe("runAfkLoop, Revision", () => {
  const branch = "issue/7-fix-streak";

  test("Revision PRs are worked before Eligible issues, oldest first, and count against the cap", async () => {
    const { sut, calls } = makeSUT({
      issues: [issue(1), issue(2)],
      revisionPullRequests: [pullRequest(31, 9), pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")], 31: [thread("T2")] },
    });

    const outcomes = await sut.run(3);

    assert.deepEqual(outcomes.map((o) => [o.issue, o.kind]), [
      [7, "revised"],
      [9, "revised"],
      [1, "pull-request"],
    ]);
    assert.deepEqual(calls.filter((call) => call.startsWith("start")), [
      "start revision issue/7-fix-streak",
      "start revision issue/9-fix-streak",
      "start issue/1-issue-1",
    ]);
  });

  test("a green Revision is pushed, answered in each thread, summarised and handed back, with only fixed threads resolved", async () => {
    const { sut, tracker, agents, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1"), thread("T2"), thread("T3"), conversation("Add a test for zero.")] },
      revisions: {
        21: { runs: [{ output: replies("C1 | fixed | Renamed.", "C2 | declined | Standards ask for value types.", "C3 | question | Which screen?", "C4 | fixed | Test added.") }] },
      },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 7, kind: "revised", pullRequest: 21, pushed: true, log: "logs/revision-1" }]);
    assert.deepEqual(calls, [
      `start revision ${branch}`,
      "inspect",
      "revise",
      "inspect",
      `test run ${branch}`,
      `push ${branch}`,
      `close ${branch}`,
      "reply T1",
      "resolve T1",
      "reply T2",
      "reply T3",
      "comment on #21",
      "relabel #21: -ready-for-agent +ready-for-human",
    ]);
    assert.deepEqual(agents.revisionComments[0]?.map((comment) => comment.id), ["C1", "C2", "C3", "C4"]);
    assert.deepEqual(tracker.replies, [
      { thread: "T1", body: "<!-- afk-loop -->\n**fixed**: Renamed." },
      { thread: "T2", body: "<!-- afk-loop -->\n**declined**: Standards ask for value types." },
      { thread: "T3", body: "<!-- afk-loop -->\n**question**: Which screen?" },
    ]);
    assert.match(
      tracker.comments[0] ?? "",
      /^<!-- afk-loop:revision-summary -->\n\nRevision 1: 2 fixed, 1 declined, 1 question\.[\s\S]*Pushed `head-1`[\s\S]*"Add a test for zero\." → \*\*fixed\*\*: Test added\.[\s\S]*`logs\/revision-1`/,
    );
  });

  test("a Revision with every comment declined or questioned answers them without a Test run or a push", async () => {
    const { sut, tracker, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1"), thread("T2")] },
      revisions: { 21: { runs: [{ commits: 0, output: replies("C1 | declined | Already done.", "C2 | question | Which one?") }] } },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 7, kind: "revised", pullRequest: 21, pushed: false, log: "logs/revision-1" }]);
    assert.equal(testRuns(calls), 0);
    assert.deepEqual(tracker.pushed, []);
    assert.deepEqual(tracker.resolved, []);
    assert.equal(tracker.replies.length, 2);
    assert.match(tracker.comments[0] ?? "", /Nothing to push/);
    assert.equal(calls.at(-1), "relabel #21: -ready-for-agent +ready-for-human");
  });

  test("a merge of main is tested and pushed even when every comment is declined", async () => {
    const { sut, tracker, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      revisions: { 21: { mergedMain: true, runs: [{ commits: 0, output: replies("C1 | declined | Already done.") }] } },
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind === "revised" && outcomes[0].pushed, true);
    assert.equal(testRuns(calls), 1);
    assert.deepEqual(tracker.pushed, [branch]);
  });

  test("a Revision PR with no open comments is handed back with a note and no session", async () => {
    const { sut, tracker, calls } = makeSUT({ issues: [], revisionPullRequests: [pullRequest(21, 7)] });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 7, kind: "no-review-comments", pullRequest: 21 }]);
    assert.deepEqual(calls, ["comment on #21", "relabel #21: -ready-for-agent +ready-for-human"]);
    assert.match(tracker.comments[0] ?? "", /^<!-- afk-loop -->\nRevision: no open review comments found/);
  });

  test("a merge conflict with main hands the PR off untouched", async () => {
    const { sut, tracker, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      revisions: { 21: { start: { kind: "merge-conflict", files: ["Sources/Streak.swift"] } } },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [
      { issue: 7, kind: "revision-handoff", pullRequest: 21, reason: "merge-conflict", baseBranch: "main", files: ["Sources/Streak.swift"] },
    ]);
    assert.deepEqual(calls, [`start revision ${branch}`, "comment on #21", "relabel #21: -ready-for-agent +ready-for-human"]);
    assert.match(tracker.comments[0] ?? "", /merging `main` into the branch conflicts[\s\S]*Sources\/Streak\.swift[\s\S]*Nothing was pushed/);
  });

  test("a merge conflict names the configured base branch", async () => {
    const { sut, tracker } = makeSUT({
      issues: [],
      baseBranch: "develop",
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      revisions: { 21: { start: { kind: "merge-conflict", files: ["Sources/Streak.swift"] } } },
    });

    await sut.run();

    assert.match(tracker.comments[0] ?? "", /merging `develop` into the branch conflicts/);
  });

  test("hand work on the local branch is never overwritten: the PR is skipped with a comment", async () => {
    const { sut, tracker, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      revisions: { 21: { start: { kind: "hand-work" } } },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 7, kind: "local-branch", branch }]);
    assert.deepEqual(calls, [`start revision ${branch}`, "comment on #21", "relabel #21: -ready-for-agent +ready-for-human"]);
    assert.match(tracker.comments[0] ?? "", /local `issue\/7-fix-streak` has work that isn't pushed/);
  });

  test("a failed Test run goes back to the Implementer, and a green one is pushed", async () => {
    const { sut, agents, tracker } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      testRunResults: ["error: boom"],
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "revised");
    assert.deepEqual(agents.revisionFeedback, [undefined, "error: boom"]);
    assert.deepEqual(tracker.pushed, [branch]);
    assert.match(tracker.comments[0] ?? "", /Pushed `head-2`/);
  });

  test("a spent Attempt budget hands the Revision off with the last feedback: nothing pushed, answered or resolved", async () => {
    const { sut, tracker, agents, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      testRunResults: ["error: one", "error: two", "error: three"],
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [
      { issue: 7, kind: "revision-handoff", pullRequest: 21, reason: "attempt-budget", log: "error: three", rawLog: `raw/${branch}` },
    ]);
    assert.equal(agents.revisionFeedback.length, 3);
    assert.deepEqual([tracker.pushed, tracker.replies, tracker.resolved], [[], [], []]);
    assert.ok(calls.includes(`discard ${branch}`));
    assert.match(tracker.comments[0] ?? "", /Attempt budget \(3\)[\s\S]*raw\/issue\/7-fix-streak[\s\S]*error: three/);
    assert.equal(calls.at(-1), "relabel #21: -ready-for-agent +ready-for-human");
  });

  test("a comment without a readable verdict spends an Attempt and is named in the feedback", async () => {
    const { sut, agents, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1"), thread("T2"), thread("T3")] },
      revisions: { 21: { runs: [{ output: replies("C1 | fixed | Done.", "C2 | maybe | Hm.") }, {}] } },
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "revised");
    assert.match(agents.revisionFeedback[1] ?? "", /no readable verdict for C2, C3\./);
    assert.equal(testRuns(calls), 1);
  });

  test("a verdict written in backticks is read", async () => {
    const { sut, tracker } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      revisions: { 21: { runs: [{ output: replies("C1 | `fixed` | Renamed.") }] } },
    });

    await sut.run();

    assert.deepEqual(tracker.resolved, ["T1"]);
  });

  test("a verdict line dressed as a bullet, in bold or capitals is read", async () => {
    const { sut, tracker } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1"), thread("T2")] },
      revisions: { 21: { runs: [{ output: replies("- C1 | **Fixed** | Renamed.", "| C2 | declined | Stale. |") }] } },
    });

    await sut.run();

    assert.deepEqual(tracker.replies.map((reply) => reply.body), ["<!-- afk-loop -->\n**fixed**: Renamed.", "<!-- afk-loop -->\n**declined**: Stale."]);
    assert.deepEqual(tracker.resolved, ["T1"]);
  });

  test("a comment marked fixed after the run removed the merge of main spends an Attempt, as nothing would be pushed", async () => {
    const { sut, tracker, agents } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      revisions: { 21: { mergedMain: true, runs: [{ commits: -1 }, { commits: 0 }, { commits: 0 }] } },
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "revision-handoff");
    assert.equal(agents.revisionFeedback[1], fixedWithoutCommitFeedback);
    assert.deepEqual(tracker.resolved, []);
  });

  test("a comment marked fixed without a commit spends an Attempt", async () => {
    const { sut, agents } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      revisions: { 21: { runs: [{ commits: 0 }, {}] } },
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "revised");
    assert.deepEqual(agents.revisionFeedback, [undefined, fixedWithoutCommitFeedback]);
  });

  test("a dirty worktree spends an Attempt and skips the Test run", async () => {
    const { sut, agents, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      revisions: { 21: { runs: [{ dirty: true }, {}] } },
    });

    await sut.run();

    assert.deepEqual(agents.revisionFeedback, [undefined, dirtyFeedback]);
    assert.equal(testRuns(calls), 1);
  });

  test("a rejected push discards the Revision's local work, so the next run isn't taken for hand work", async () => {
    const { sut, tracker, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7)],
      reviewComments: { 21: [thread("T1")] },
      pushFails: true,
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [{ issue: 7, kind: "error", message: "Error: push rejected" }]);
    assert.equal(calls.at(-1), `discard ${branch}`);
    assert.deepEqual(tracker.replies, []);
  });

  test("a stray label flip with no review comments doesn't count against the cap", async () => {
    const { sut } = makeSUT({ issues: [issue(1)], revisionPullRequests: [pullRequest(21, 7)] });

    const outcomes = await sut.run(1);

    assert.deepEqual(outcomes.map((o) => o.kind), ["no-review-comments", "pull-request"]);
  });

  test("a Revision PR that stops qualifying mid-run is skipped silently", async () => {
    const { sut, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7), pullRequest(31, 9)],
      reviewComments: { 21: [thread("T1")], 31: [thread("T2")] },
      withdrawnAfterFirstRevision: [31],
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes.map((o) => o.issue), [7]);
    assert.ok(!calls.some((call) => call.includes("#31")));
  });

  test("a Revision never relabels its issue", async () => {
    const { sut, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(21, 7), pullRequest(31, 9), pullRequest(41, 11)],
      reviewComments: { 21: [thread("T1")], 31: [thread("T2")] },
      revisions: { 31: { runs: [{ dirty: true }, { dirty: true }, { dirty: true }] } },
    });

    await sut.run();

    assert.deepEqual(calls.filter((call) => call.startsWith("relabel")).map((call) => call.split(":")[0]), [
      "relabel #21",
      "relabel #31",
      "relabel #41",
    ]);
  });
});

describe("runAfkLoop, PR body", () => {
  test("the Drafter's draft sits between the Closes line and the Host's own lines", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], drafts: { 1: ["## Summary\n\nShows the Streak badge."] } });

    await sut.run();

    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\n## Summary\n\nShows the Streak badge\.\n\nImplemented by the AFK loop's Implementer/);
  });

  test("the draft is written once, after the last Test run, from what it verified", async () => {
    const { sut, agents } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{}, {}, {}] },
      testRunResults: [green, "error: boom", green],
      drafts: { 1: ["## Summary"] },
    });

    await sut.run();

    assert.deepEqual(agents.testRunsBeforeDraft, [3]);
    assert.match(agents.draftTestRuns[0] ?? "", /^Verified: the Test run passed on the reviewed commit/);
  });

  test("a draft closes no issue of its own", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], drafts: { 1: ["Fixes #9 and closes: acme/Habitat#10. The dialog closes on Save."] } });

    await sut.run();

    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\nRefs #9 and Refs: acme\/Habitat#10\. The dialog closes on Save\.\n\n/);
  });

  test("a missing draft is asked for once more", async () => {
    const { sut, tracker, agents } = makeSUT({ issues: [issue(1)], drafts: { 1: [undefined, "## Summary"] } });

    await sut.run();

    assert.equal(agents.draftTestRuns.length, 2);
    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\n## Summary\n\n/);
  });

  test("a Drafter run that fails counts as a missing draft", async () => {
    const { sut, tracker } = makeSUT({ issues: [issue(1)], drafts: { 1: [new Error("agent crashed"), "## Summary"] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\n## Summary\n\n/);
  });

  test("with no draft after two runs the Host's own lines follow the Closes line", async () => {
    const { sut, tracker, agents } = makeSUT({ issues: [issue(1)] });

    await sut.run();

    assert.equal(agents.draftTestRuns.length, 2);
    assert.match(tracker.pullRequests[0]?.body ?? "", /^Closes #1\.\n\nImplemented by the AFK loop's Implementer/);
  });

  test("a Handoff drafts nothing", async () => {
    const { sut, agents } = makeSUT({ issues: [issue(1)], testRunResults: ["error: boom", "error: boom", "error: boom"] });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "handoff");
    assert.equal(agents.draftTestRuns.length, 0);
  });
});

describe("runAfkLoop, routing", () => {
  test("the Test run covers the platforms the branch changes, and the PR says what was verified", async () => {
    const { sut, tracker, testRunner } = makeSUT({ issues: [issue(1)], runs: { 1: [{ platforms: [server] }, { platforms: [web, server] }] } });

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
    assert.deepEqual(calls.slice(1, 5), ["implement", "inspect", "review", "inspect"]);
    assert.equal(testRuns(calls), 0);
    assert.match(tracker.pullRequests[0]?.body ?? "", /\n\nNo Test run: the branch changes neither `web\/` nor `server\/`\.$/);
  });

  test("a Revision's Test run covers the platforms its branch changes", async () => {
    const { sut, testRunner } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(20, 7)],
      reviewComments: { 20: [thread("T1")] },
      revisions: { 20: { platforms: [server] } },
    });

    await sut.run();

    assert.deepEqual(testRunner.platforms, [[server]]);
  });

  test("a Revision on a branch changing neither platform is pushed without a Test run", async () => {
    const { sut, tracker, calls } = makeSUT({
      issues: [],
      revisionPullRequests: [pullRequest(20, 7)],
      reviewComments: { 20: [thread("T1")] },
      revisions: { 20: { platforms: [] } },
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "revised");
    assert.equal(testRuns(calls), 0);
    assert.deepEqual(tracker.pushed, ["issue/7-fix-streak"]);
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
  revisionPullRequests?: RevisionPullRequest[];
  reviewComments?: Record<number, ReviewComment[]>;
  revisions?: Record<number, RevisionFixture>;
  withdrawnAfterFirstRevision?: number[];
  issuesWithOpenPullRequest?: number[];
  pushedBranches?: string[];
  localBranches?: Record<number, LocalBranch[]>;
  runs?: Record<number, Run[]>;
  drafts?: Record<number, (string | Error | undefined)[]>;
  testRunResults?: (string | null)[];
  pushFails?: boolean;
  linkedIssues?: LinkedIssue[];
  baseBranch?: string;
}

interface RevisionFixture {
  start?: Exclude<RevisionStart, { kind: "session" }>;
  mergedMain?: boolean;
  platforms?: Platform[];
  runs?: (Run & { output?: string })[];
}

interface Run {
  commits?: number;
  movesHead?: boolean;
  dirty?: boolean;
  platforms?: Platform[];
  openFindings?: boolean;
  unfixedFindings?: string;
  reply?: string;
}

function makeSUT(fixture: Fixture) {
  const calls: string[] = [];
  const tracker = new SpyTracker(fixture, calls);
  const agents = new SpyAgents(fixture, calls);
  const testRunner = new SpyTestRunner(fixture.testRunResults ?? [], calls);
  const sut = { run: (cap?: number) => runAfkLoop({ tracker, agents, testRunner, cap, baseBranch: fixture.baseBranch ?? "main", platforms: [web, server] }) };
  return { sut, tracker, agents, testRunner, calls };
}

const green = null;

function platform(name: string): Platform {
  return { name, folder: name, standards: "", agentBuildHint: "", verified: `the ${name} tests`, steps: async () => [] };
}

const web = platform("web");
const server = platform("server");

function testRuns(calls: string[]): number {
  return calls.filter((call) => call.startsWith("test run")).length;
}

function issue(number: number, overrides: Partial<Issue> = {}): Issue {
  return { number, title: `Issue ${number}`, body: "", labels: ["ready-for-agent"], openBlockers: 0, ...overrides };
}

function pullRequest(number: number, issueNumber: number): RevisionPullRequest {
  return { number, branch: `issue/${issueNumber}-fix-streak`, issue: issue(issueNumber, { labels: [] }), revision: 1 };
}

function thread(id: string): ReviewComment {
  return { kind: "inline", thread: id, author: "knn90", body: `Comment ${id}`, path: "Sources/Streak.swift", line: 12, diffHunk: "@@ -1 +1 @@", replies: [] };
}

function conversation(body: string): ReviewComment {
  return { kind: "conversation", author: "knn90", body, replies: [] };
}

function replies(...lines: string[]): string {
  return `Work done.\n\n<replies>\n${lines.join("\n")}\n</replies>`;
}

class SpyTracker implements Tracker {
  issues: Issue[];
  pushedBranches: string[];
  pushed: string[] = [];
  pullRequests: PullRequest[] = [];
  comments: string[] = [];
  replies: { thread: string; body: string }[] = [];
  resolved: string[] = [];
  private revisionQueue: RevisionPullRequest[];

  constructor(
    private readonly fixture: Fixture,
    private readonly calls: string[],
  ) {
    this.issues = fixture.issues;
    this.pushedBranches = [...(fixture.pushedBranches ?? [])];
    this.revisionQueue = [...(fixture.revisionPullRequests ?? [])];
  }

  async revisionPullRequests() {
    return this.revisionQueue;
  }

  async linkedIssues(numbers: readonly number[]) {
    return (this.fixture.linkedIssues ?? []).filter((linked) => numbers.includes(linked.number));
  }

  async reviewComments(pullRequest: number) {
    return this.fixture.reviewComments?.[pullRequest] ?? [];
  }

  async replyInThread(thread: string, body: string) {
    this.calls.push(`reply ${thread}`);
    this.replies.push({ thread, body });
  }

  async resolveThread(thread: string) {
    this.calls.push(`resolve ${thread}`);
    this.resolved.push(thread);
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
    this.pullRequests.push(pullRequest);
    return `https://pr/${pullRequest.branch}`;
  }

  async comment(issueNumber: number, body: string) {
    this.calls.push(`comment on #${issueNumber}`);
    this.comments.push(body);
  }

  async relabel(issueNumber: number, { remove, add }: Relabel) {
    this.calls.push(`relabel #${issueNumber}: -${remove}${add ? ` +${add}` : ""}`);
    const withdrawn = this.fixture.withdrawnAfterFirstRevision ?? [];
    this.revisionQueue = this.revisionQueue.filter((pr) => pr.number !== issueNumber && !withdrawn.includes(pr.number));
    this.issues = this.issues.map((i) =>
      i.number === issueNumber ? { ...i, labels: [...i.labels.filter((l) => l !== remove), ...(add ? [add] : [])] } : i,
    );
  }
}

class SpyAgents implements Agents {
  startedIssues: number[] = [];
  started: Issue[] = [];
  feedback: (string | undefined)[] = [];
  reviewFeedback: (string | undefined)[] = [];
  revisionFeedback: (string | undefined)[] = [];
  revisionComments: NumberedComment[][] = [];
  draftTestRuns: string[] = [];
  testRunsBeforeDraft: number[] = [];
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

  async startRevision({ number, branch }: RevisionPullRequest, comments: readonly NumberedComment[]): Promise<RevisionStart> {
    this.calls.push(`start revision ${branch}`);
    this.revisionComments.push([...comments]);
    const fixture = this.fixture.revisions?.[number] ?? {};
    if (fixture.start) return fixture.start;
    let runIndex = -1;
    let commitsAhead = fixture.mergedMain ? 1 : 0;
    let headVersion = 0;
    const run = () => fixture.runs?.[runIndex] ?? {};
    return {
      kind: "session",
      session: {
        exec: this.openSandbox(),
        revise: async (feedback) => {
          this.calls.push("revise");
          this.revisionFeedback.push(feedback);
          runIndex += 1;
          const commits = run().commits ?? 1;
          commitsAhead += commits;
          if (commits !== 0) headVersion += 1;
          const allFixed = replies(...comments.map((comment) => `${comment.id} | fixed | Done.`));
          return { output: run().output ?? allFixed, log: `logs/revision-${this.revisionFeedback.length}` };
        },
        inspect: async () => {
          this.calls.push("inspect");
          return { dirty: run().dirty ?? false, head: `head-${headVersion}`, commitsAhead, platforms: fixture.platforms ?? [web] };
        },
        close: async () => {
          this.calls.push(`close ${branch}`);
        },
        discard: async () => {
          this.calls.push(`discard ${branch}`);
        },
      },
    };
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
    const drafts = [...(this.fixture.drafts?.[issue.number] ?? [])];
    let runIndex = -1;
    let commitsAhead = 0;
    let headVersion = 0;
    const run = (): Run => runs[runIndex] ?? {};
    const agentRun = () => {
      runIndex += 1;
      const commits = run().commits ?? 1;
      commitsAhead += commits;
      if (commits !== 0 || run().movesHead) headVersion += 1;
    };
    return {
      exec: this.openSandbox(),
      implement: async (feedback) => {
        this.calls.push("implement");
        this.feedback.push(feedback);
        agentRun();
        return { reply: run().reply ?? "", log: `logs/implementer-${this.feedback.length}` };
      },
      review: async (feedback) => {
        this.calls.push("review");
        this.reviewFeedback.push(feedback);
        agentRun();
        const { openFindings = false, unfixedFindings } = run();
        return { log: `logs/review-${this.reviewFeedback.length}`, openFindings, unfixedFindings };
      },
      draft: async (testRun) => {
        this.draftTestRuns.push(testRun);
        this.testRunsBeforeDraft.push(testRuns(this.calls));
        const draft = drafts.shift();
        if (draft instanceof Error) throw draft;
        return draft;
      },
      inspect: async () => {
        this.calls.push("inspect");
        return { dirty: run().dirty ?? false, head: `head-${headVersion}`, commitsAhead, platforms: run().platforms ?? [web] };
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
