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
  type Relabel,
  type SandboxExec,
  type TestRunner,
  type Tracker,
} from "./afk-loop.js";
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

  test("an Implementer with no commits opens no PR and the issue isn't picked again", async () => {
    const { sut, agents, tracker } = makeSUT({ issues: [issue(1), issue(2)], runs: { 1: [{ commits: 0 }] } });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes.map((o) => [o.issue, o.kind]), [
      [1, "no-commits"],
      [2, "pull-request"],
    ]);
    assert.deepEqual(agents.startedIssues, [1, 2]);
    assert.deepEqual(tracker.pushed, ["issue/2-issue-2"]);
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
        hasCommits: true,
        log: "error: three",
        rawLog: `raw/${branch}`,
        lastGreenHead: "head-1",
        pullRequest: `https://pr/${branch}`,
      },
    ]);
    assert.equal(agents.reviewFeedback.length, 3);
    assert.match(tracker.pullRequests[0]?.body ?? "", /in review[\s\S]*last green at `head-1`[\s\S]*error: three/);
    assert.match(tracker.comments[0] ?? "", /in review[\s\S]*last green at `head-1`[\s\S]*https:\/\/pr\//);
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
        hasCommits: true,
        log: dirtyFeedback,
        lastGreenHead: "head-2",
        pullRequest: "https://pr/issue/1-issue-1",
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
    assert.match(tracker.comments[0] ?? "", /lost its commits in review; `head-1` is still in the local repository/);
    assert.doesNotMatch(tracker.comments[0] ?? "", /uncommitted work|Test run output filtered/);
  });

  test("a Reviewer leaving a dirty worktree is asked for a commit before any Test run", async () => {
    const { sut, agents, calls } = makeSUT({ issues: [issue(1)], runs: { 1: [{}, { dirty: true }, {}] } });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "pull-request");
    assert.deepEqual(agents.reviewFeedback, [undefined, dirtyFeedback]);
    assert.equal(testRuns(calls), 2);
  });

  test("three failed Attempts hand off: PR with the last failure log, comment, relabel", async () => {
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
        hasCommits: true,
        log: "error: three",
        rawLog: `raw/${branch}`,
        pullRequest: `https://pr/${branch}`,
      },
    ]);
    assert.equal(agents.feedback.length, 3);
    assert.deepEqual(calls.slice(-5), [
      `close ${branch}`,
      "relabel #1: -ready-for-agent +ready-for-human",
      `push ${branch}`,
      `open PR ${branch}`,
      "comment on #1",
    ]);
    assert.equal(tracker.pullRequests[0]?.title, "[#1] - Handoff: Issue 1");
    assert.match(tracker.pullRequests[0]?.body ?? "", /^Refs #1\.[\s\S]*Attempt budget[\s\S]*raw\/issue\/1-issue-1[\s\S]*error: three/);
    assert.match(tracker.comments[0] ?? "", /To requeue for the loop: close the PR, delete `issue\/1-issue-1` on GitHub, remove the local/);
    assert.match(tracker.comments[0] ?? "", /Attempt budget[\s\S]*https:\/\/pr\/issue\/1-issue-1/);
    assert.doesNotMatch(tracker.comments[0] ?? "", /error: three/);
  });

  test("three failed Attempts with no commits hand off with the log in the comment and no PR", async () => {
    const { sut, tracker, calls } = makeSUT({
      issues: [issue(1)],
      runs: { 1: [{ dirty: true, commits: 0 }, { dirty: true, commits: 0 }, { dirty: true, commits: 0 }] },
    });

    const outcomes = await sut.run();

    assert.deepEqual(outcomes, [
      { issue: 1, kind: "handoff", branch: "issue/1-issue-1", reason: "attempt-budget", hasCommits: false, log: dirtyFeedback },
    ]);
    assert.deepEqual(tracker.pushed, []);
    assert.deepEqual(tracker.pullRequests, []);
    assert.deepEqual(calls.slice(-2), ["relabel #1: -ready-for-agent +ready-for-human", "comment on #1"]);
    assert.match(tracker.comments[0] ?? "", /uncommitted work, in its local worktree[\s\S]*Commit all changes[\s\S]*To requeue for the loop: remove the local/);
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
        hasCommits: true,
        log: dirtyFeedback,
        pullRequest: "https://pr/issue/1-issue-1",
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
        hasCommits: true,
        log: `${dirtyFeedback}\n\nThe Test run before it reported:\n\nerror: two`,
        rawLog: "raw/issue/1-issue-1",
        pullRequest: "https://pr/issue/1-issue-1",
      },
    ]);
  });

  test("a failed Handoff PR still comments the details and the pushed branch, and the loop moves on", async () => {
    const { sut, agents, tracker, calls } = makeSUT({
      issues: [issue(1), issue(2)],
      runs: { 1: [{ dirty: true }, { dirty: true }, { dirty: true }] },
      pullRequestFails: true,
    });

    const outcomes = await sut.run();

    assert.equal(outcomes[0]?.kind, "handoff");
    assert.ok(calls.includes("relabel #1: -ready-for-agent +ready-for-human"));
    assert.match(tracker.comments[0] ?? "", /is pushed; opening its PR failed[\s\S]*Commit all changes[\s\S]*To requeue for the loop: delete/);
    assert.deepEqual(agents.startedIssues, [1, 2]);
  });

  test("a Handoff log too long for GitHub is truncated", async () => {
    const log = `error: ${"x".repeat(70_000)}`;
    const { sut, tracker } = makeSUT({ issues: [issue(1)], testRunResults: [log, log, log] });

    await sut.run();

    const body = tracker.pullRequests[0]?.body ?? "";
    assert.ok(body.length < 65_536);
    assert.match(body, /… truncated\n```\n/);
  });

  test("a Handoff log is fenced past any backticks it holds", async () => {
    const log = "error: ```swift\n@someone ``` mention";
    const { sut, tracker } = makeSUT({ issues: [issue(1)], testRunResults: [log, log, log] });

    await sut.run();

    assert.match(tracker.pullRequests[0]?.body ?? "", /\n````text\nerror: ```swift\n@someone ``` mention\n````/);
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
      runs: { 1: [{}, { pullRequestDraft: "## Summary\n\nFirst." }, { pullRequestDraft: "## Summary\n\nLast." }] },
      testRunResults: [green, "error: boom", green],
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
  pullRequestFails?: boolean;
  linkedIssues?: LinkedIssue[];
}

interface Run {
  commits?: number;
  movesHead?: boolean;
  dirty?: boolean;
  platforms?: Platform[];
  openFindings?: boolean;
  unfixedFindings?: string;
  pullRequestDraft?: string;
}

function makeSUT(fixture: Fixture) {
  const calls: string[] = [];
  const tracker = new SpyTracker(fixture, calls);
  const agents = new SpyAgents(fixture, calls);
  const testRunner = new SpyTestRunner(fixture.testRunResults ?? [], calls);
  const sut = { run: (cap?: number) => runAfkLoop({ tracker, agents, testRunner, cap, platforms: [web, server] }) };
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

class SpyTracker implements Tracker {
  issues: Issue[];
  pushedBranches: string[];
  pushed: string[] = [];
  pullRequests: PullRequest[] = [];
  comments: string[] = [];

  constructor(
    private readonly fixture: Fixture,
    private readonly calls: string[],
  ) {
    this.issues = fixture.issues;
    this.pushedBranches = [...(fixture.pushedBranches ?? [])];
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
    if (this.fixture.pullRequestFails) throw new Error("pull request rejected");
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
      },
      review: async (feedback) => {
        this.calls.push("review");
        this.reviewFeedback.push(feedback);
        agentRun();
        const { openFindings = false, unfixedFindings, pullRequestDraft } = run();
        return { log: `logs/review-${this.reviewFeedback.length}`, openFindings, unfixedFindings, pullRequestDraft };
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
