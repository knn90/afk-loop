import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FixRound, Issue, OpenFinding } from "./afk-loop.js";
import type { Platform } from "./platforms.js";
import { answeredOpenFindings, firstReview, fixableFindings, openFindings, pullRequestDraft, reviewerPrompt, wrapUpPrompt } from "./reviewer-prompt.js";

describe("reviewerPrompt", () => {
  test("reads the glossary, and the glossary map when it exists", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Read GLOSSARY\.md and use its vocabulary; if GLOSSARY-MAP\.md exists, follow it to the glossary of the code you work on\./);
    assert.ok(!prompt.includes("CONTEXT"));
  });

  test("the issue carries its comments, so a point a comment settles is the issue's own text", () => {
    const sut = makeSUT(undefined, ["Use the weekly streak."]);

    const prompt = sut.prompt();

    assert.ok(prompt.includes("<issue>\n# Fix streak\n\nBody\n\n<comment>\nUse the weekly streak.\n</comment>\n</issue>"));
  });

  test("names the code-review skill and inlines its Spec, Standards and diff range", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /`mattpocock-skills:code-review` skill/);
    assert.ok(!prompt.includes("/code-review"));
    assert.match(prompt, /<issue>\n# Fix streak\n\nBody\n<\/issue>/);
    assert.match(prompt, /<coding-standards>\nPrefer value types\.\n<\/coding-standards>/);
    assert.match(prompt, /`git diff abc123\.\.\.HEAD`/);
  });

  test("inlines the standards of every platform the branch changes", () => {
    const sut = makeSUT(["# Web Coding Standards", "# Server Coding Standards"]);

    const prompt = sut.prompt();

    assert.match(prompt, /<coding-standards>\n# Web Coding Standards\n\n# Server Coding Standards\n<\/coding-standards>/);
  });

  test("says no standards apply when the branch changes no platform", () => {
    const sut = makeSUT([]);

    const prompt = sut.prompt();

    assert.match(prompt, /<coding-standards>\nNone apply: this branch changes neither `web\/` nor `server\/`\.\n<\/coding-standards>/);
  });

  test("follows the code review with a Design review through the codebase-design skill", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(prompt.indexOf("`mattpocock-skills:code-review` skill") < prompt.indexOf("`mattpocock-skills:codebase-design` skill"));
    assert.match(prompt, /\n- Then invoke the `mattpocock-skills:codebase-design` skill/);
    assert.match(prompt, /record each shallow module, hypothetical seam and test that reaches past an interface as a Design finding/);
  });

  test("the Reviewer changes no file, and is told the Host discards what it leaves", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /- You change no file and commit nothing\. The Host puts the branch back at the commit the Test run passed, whatever your run leaves behind\./);
    assert.ok(!prompt.includes("Fix every"));
    assert.ok(!prompt.includes("Commit every fix"));
    assert.ok(!prompt.includes("all committed"));
  });

  test("the Reviewer may build and test in the Sandbox to check a finding, with no Test run after it", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(
      prompt.includes(
        "- This Sandbox is a macOS VM with Node and Go. To check a finding you may build and test: for `web/`, run `make web`; for `server/`, run `make server`. No Test run follows your run.",
      ),
    );
    assert.ok(!prompt.includes("container"));
  });

  test("carries the four-part test for an Open finding, every other finding being Fixable", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(
      prompt.includes(
        [
          "- Sort every Spec, Standards and Design finding: each is Open or Fixable. A finding is Open when any of these holds; otherwise it is Fixable:",
          "  - fixing it changes behaviour the issue asked for, or the issue does not say which way to go;",
          "  - there is more than one reasonable fix, with different results for the user or for the design;",
          "  - the fix reaches outside this diff: another module, or a later issue's work;",
          "  - you are not sure the finding is valid.",
        ].join("\n"),
      ),
    );
  });

  test("a real problem outside the issue's work is an Open finding, and a point the issue settles is left out", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(prompt.includes("- A real problem that is not this issue's work is an Open finding. A point the <issue>'s own text settles is not a finding: leave it out."));
  });

  test("asks for the Fixable findings as text for the Implementer", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /- Fixable findings: [^\n]*Write them as text for the Implementer: for each, its file and line, what is wrong and what fixed looks like\./);
  });

  test("asks for each Open finding with its text and, where it has one, its path and line", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /- Open findings: the maintainer must decide them\. Write them one each, as `<finding path="path\/to\/file" line="12">[^\n]*<\/finding>`\./);
    assert.match(prompt, /a line on the new side of the branch diff\. Leave both out when the finding has no single line/);
    assert.match(prompt, /the branch diff, `git diff abc123\.\.\.HEAD`/);
    assert.match(prompt, /The Host posts each one as a review comment on the PR/);
  });

  test("carries no host feedback and asks for no count of Open findings", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(!prompt.includes("host-feedback"));
    assert.ok(!prompt.includes("<open-findings>N"));
    assert.ok(!prompt.includes("unfixed-findings"));
  });
});

describe("reviewerPrompt, PR body", () => {
  test("drafts the PR body with the pr skill only when it has no Fixable finding", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /With no Fixable finding, invoke the `mattpocock-skills:pr` skill with the Skill tool and draft the PR body for the branch diff\. With a Fixable finding, draft none/);
    assert.match(prompt, /Done means every finding is in one of the two findings blocks and, with no Fixable finding, the draft is in the <pr-body> block\./);
  });

  test("ends on the reply's three blocks, each named once as a pair, then the completion signal", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(
      prompt.endsWith(
        "End your reply with these blocks, each once and in this order, then <promise>COMPLETE</promise>. An empty block means none. Write these tags nowhere else in your reply.\n\n<fixable-findings>\n</fixable-findings>\n<open-findings>\n</open-findings>\n<pr-body>\n</pr-body>",
      ),
    );
    for (const tag of ["fixable-findings", "open-findings", "pr-body"]) assert.equal(prompt.split(`</${tag}>`).length, 2);
  });

  test("the draft starts at the Summary and leaves the Closes line to the Host", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /The draft starts at `## Summary` and names other issues as `Refs #n`\. The Host puts `Closes #7\.` above it/);
  });

  test("Evidence is output the Reviewer ran itself, the Test run result being the Host's to add", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Evidence: quote only output of commands you run in this Sandbox\. The Host adds what the Test run verified\./);
  });

  test("Open findings stay in their block, out of the draft", () => {
    const sut = makeSUT();

    for (const prompt of [sut.prompt(), sut.wrapUp()]) assert.ok(prompt.includes("  - The draft describes the change. Open findings go in the <open-findings> block alone."));
  });
});

describe("wrapUpPrompt", () => {
  test("the issue carries its comments", () => {
    const sut = makeSUT(undefined, ["Use the weekly streak."]);

    const prompt = sut.wrapUp();

    assert.ok(prompt.includes("<issue>\n# Fix streak\n\nBody\n\n<comment>\nUse the weekly streak.\n</comment>\n</issue>"));
  });

  test("carries run 1's Fixable findings, and its Open findings with their paths and lines", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.match(prompt, /<fixable-findings>\nweb\/src\/streak\.ts:12: rename `x`\.\n<\/fixable-findings>/);
    assert.match(
      prompt,
      /<open-findings>\n<finding path="web\/src\/streak\.ts" line="12">The streak resets at UTC midnight\.<\/finding>\n<finding>No test covers a skipped day\.<\/finding>\n<\/open-findings>/,
    );
  });

  test("carries the path of an Open finding of run 1 that has no line", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp([{ text: "Shallow module.", at: { path: "web/src/streak.ts" } }]);

    assert.ok(prompt.includes('<open-findings>\n<finding path="web/src/streak.ts">Shallow module.</finding>\n</open-findings>'));
  });

  test("names the commit run 1 reviewed and the Fix round's commits after it", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.match(prompt, /You reviewed it at `def456`\.[^\n]*`git log def456\.\.HEAD`, and there may be none/);
  });

  test("reviews the Fix round's commits only, with the code-review skill and no Design review", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.ok(
      prompt.includes(
        [
          "- With no commit after `def456`, go to the next step. Otherwise review the Fix round's commits only: invoke the `mattpocock-skills:code-review` skill with the Skill tool. Its inputs are all here:",
          "  - Fixed point: `def456`, so the diff is `git diff def456...HEAD`.",
          "  - Spec: your Fixable findings and the <issue> block.",
          "  - Standards: the <coding-standards> block.",
          "- Every finding in the Fix round's commits",
        ].join("\n"),
      ),
    );
    assert.match(prompt, /<coding-standards>\nPrefer value types\.\n<\/coding-standards>/);
    assert.ok(!prompt.includes("codebase-design"));
  });

  test("every finding in the Fix round's commits is an Open finding, whatever its kind", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.ok(prompt.includes("- Every finding in the Fix round's commits is an Open finding, whatever its kind: this was the one Fix round. A point the <issue>'s own text settles is not a finding: leave it out."));
  });

  test("carries the findings the Implementer left, and puts its reason on each one left unfixed", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp(runOneOpenFindings, { findingsLeft: "1. `x` is the name the issue asks for." });

    assert.ok(prompt.includes("The findings the Implementer left, and why:\n\n<findings-left>\n1. `x` is the name the issue asks for.\n</findings-left>"));
    assert.ok(
      prompt.includes(
        "- Check each Fixable finding against the branch diff. One that was not fixed becomes an Open finding, carrying the Implementer's reason from <findings-left> where it gave one.",
      ),
    );
    assert.ok(prompt.includes("The branch diff is `git diff abc123...HEAD`."));
  });

  test("an Implementer that listed no finding left has an empty block", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.match(prompt, /<findings-left>\n\n<\/findings-left>/);
  });

  test("asks for the final Open findings: run 1's restated, each Fixable finding not fixed, each finding in the Fix round's commits", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.match(prompt, /Restate each of your Open findings against the branch diff: its text as it holds now, its `path` and `line` as HEAD has them\./);
    assert.match(
      prompt,
      /- The final Open findings are yours restated, each Fixable finding not fixed and each finding in the Fix round's commits\. Write them one each, as `<finding path="path\/to\/file" line="12">/,
    );
    assert.match(prompt, /Done means the Fix round's commits are reviewed, every Fixable finding is checked, every final Open finding is in the <open-findings> block and the draft is in the <pr-body> block\./);
  });

  test("after a failed Fix round: its commits are dropped, nothing is reviewed and every Fixable finding becomes an Open finding", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp(runOneOpenFindings, { failed: true, findingsLeft: "1. `x` is the name the issue asks for." });

    assert.ok(
      prompt.includes(
        "You reviewed it at `def456`. The Implementer then had one Fix round on your Fixable findings. It failed its Test run, so the Host dropped its commits: the branch is back at `def456`, the commit that passed the Test run, and none of your Fixable findings is fixed.",
      ),
    );
    assert.ok(prompt.includes("- The branch is the one you reviewed, so there is nothing to review."));
    assert.ok(prompt.includes("- Every Fixable finding becomes an Open finding, carrying the Implementer's reason from <findings-left> where it gave one."));
    assert.ok(prompt.includes("<findings-left>\n1. `x` is the name the issue asks for.\n</findings-left>"));
    assert.match(prompt, /- The final Open findings are yours and every Fixable finding\. Write them one each, as `<finding /);
    assert.match(prompt, /invoke the `mattpocock-skills:pr` skill with the Skill tool and draft the PR body for the branch diff\./);
    assert.match(prompt, /Done means every Fixable finding is an Open finding, every final Open finding is in the <open-findings> block and the draft is in the <pr-body> block\./);
    assert.ok(!prompt.includes("code-review"));
    assert.ok(!prompt.includes("<coding-standards>"));
    assert.ok(!prompt.includes("git log"));
  });

  test("drafts the PR body with the pr skill, for the branch as the Fix round left it", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.match(prompt, /Then invoke the `mattpocock-skills:pr` skill with the Skill tool and draft the PR body for the branch diff\./);
    assert.match(prompt, /The draft starts at `## Summary`[^\n]*`Closes #7\.`/);
  });

  test("names itself the Wrap-up, and ends on the reply's two blocks, then the completion signal", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.match(prompt, /^You are the Reviewer for issue #7 of acme\/Habitat, on the Wrap-up of your review of branch `issue\/7-fix-streak`\./);
    assert.ok(
      prompt.endsWith(
        "End your reply with these blocks, each once and in this order, then <promise>COMPLETE</promise>. An empty <open-findings> block means none. Write these tags nowhere else in your reply.\n\n<open-findings>\n</open-findings>\n<pr-body>\n</pr-body>",
      ),
    );
  });

  test("the Reviewer changes no file in the wrap-up either", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp();

    assert.match(prompt, /- You change no file and commit nothing\./);
    assert.match(prompt, /No Test run follows your run\./);
  });

  test("with no Open finding from run 1 the block is empty", () => {
    const sut = makeSUT();

    const prompt = sut.wrapUp([]);

    assert.match(prompt, /<open-findings>\n\n<\/open-findings>/);
  });
});

describe("fixableFindings", () => {
  test("a reply with Fixable findings gives their text", () => {
    const sut = makeSUT();

    const findings = sut.fixableFindings("Done.\n<fixable-findings>\n1. web/src/streak.ts:12: rename `x`.\n2. Add the missing test.\n</fixable-findings>");

    assert.equal(findings, "1. web/src/streak.ts:12: rename `x`.\n2. Add the missing test.");
  });

  test("an empty block or a missing one gives none", () => {
    const sut = makeSUT();

    assert.equal(sut.fixableFindings("<fixable-findings>\n</fixable-findings>"), undefined);
    assert.equal(sut.fixableFindings("All clean."), undefined);
  });

  test("a block that only says none gives none", () => {
    const sut = makeSUT();

    assert.equal(sut.fixableFindings("<fixable-findings>\nNone.\n</fixable-findings>"), undefined);
    assert.equal(sut.fixableFindings("<fixable-findings>none</fixable-findings>"), undefined);
  });

  test("the last block in the reply is the one read", () => {
    const sut = makeSUT();

    const findings = sut.fixableFindings("They go in `<fixable-findings>…</fixable-findings>`.\n<fixable-findings>Rename `x`.</fixable-findings>");

    assert.equal(findings, "Rename `x`.");
  });
});

describe("pullRequestDraft", () => {
  test("a reply with a draft gives the draft", () => {
    const sut = makeSUT();

    const draft = sut.pullRequestDraft("Done.\n<pr-body>\n## Summary\n\nShows the Streak badge.\n</pr-body>\n<promise>COMPLETE</promise>");

    assert.equal(draft, "## Summary\n\nShows the Streak badge.");
  });

  test("a reply with no draft gives none", () => {
    const sut = makeSUT();

    const draft = sut.pullRequestDraft("Done.");

    assert.equal(draft, undefined);
  });

  test("the last draft in the reply is the one given", () => {
    const sut = makeSUT();

    const draft = sut.pullRequestDraft("I put it in `<pr-body>…</pr-body>`.\n<pr-body>## Summary</pr-body>");

    assert.equal(draft, "## Summary");
  });

  test("an unclosed mention before the draft stays out of it", () => {
    const sut = makeSUT();

    const draft = sut.pullRequestDraft("The draft goes after `<pr-body>`.\n<pr-body>## Summary</pr-body>");

    assert.equal(draft, "## Summary");
  });
});

describe("openFindings", () => {
  test("a finding with a path and a line is read with both", () => {
    const sut = makeSUT();

    const findings = sut.openFindings('Done.\n<open-findings>\n<finding path="web/src/streak.ts" line="12">The streak resets at UTC midnight.</finding>\n</open-findings>');

    assert.deepEqual(findings, [{ text: "The streak resets at UTC midnight.", at: { path: "web/src/streak.ts", line: 12 } }]);
  });

  test("a finding with no path is read as its text alone", () => {
    const sut = makeSUT();

    const findings = sut.openFindings('<open-findings>\n<finding>No test covers a\nskipped day.</finding>\n<finding line="12">No path.</finding>\n</open-findings>');

    assert.deepEqual(findings, [{ text: "No test covers a\nskipped day." }, { text: "No path." }]);
  });

  test("a finding with a path and no line keeps its path", () => {
    const sut = makeSUT();

    const findings = sut.openFindings('<open-findings><finding path="web/src/streak.ts">Shallow module.</finding></open-findings>');

    assert.deepEqual(findings, [{ text: "Shallow module.", at: { path: "web/src/streak.ts" } }]);
  });

  test("a reply with no block has none", () => {
    const sut = makeSUT();

    const findings = sut.openFindings("All fixed.\n<promise>COMPLETE</promise>");

    assert.deepEqual(findings, []);
  });

  test("an empty block has none", () => {
    const sut = makeSUT();

    const findings = sut.openFindings("<open-findings>\n</open-findings>");

    assert.deepEqual(findings, []);
  });

  test("the last block in the reply is the one read", () => {
    const sut = makeSUT();

    const findings = sut.openFindings("I list them in `<open-findings><finding>…</finding></open-findings>`.\n<open-findings><finding>One.</finding></open-findings>");

    assert.deepEqual(findings, [{ text: "One." }]);
  });
});

describe("answeredOpenFindings", () => {
  test("a reply with no block has no answer, told from an empty block's none", () => {
    const sut = makeSUT();

    assert.equal(sut.answeredOpenFindings("All fixed.\n<promise>COMPLETE</promise>"), undefined);
    assert.deepEqual(sut.answeredOpenFindings("<open-findings>\n</open-findings>"), []);
    assert.deepEqual(sut.answeredOpenFindings("<open-findings>\nNone.\n</open-findings>"), []);
  });

  test("a block with text and no finding the Host can read has no answer", () => {
    const sut = makeSUT();

    assert.equal(sut.answeredOpenFindings("<open-findings>\n- web/src/streak.ts:12 resets at UTC midnight\n</open-findings>"), undefined);
  });

  test("a block with findings gives them", () => {
    const sut = makeSUT();

    const findings = sut.answeredOpenFindings("<open-findings><finding>One.</finding></open-findings>");

    assert.deepEqual(findings, [{ text: "One." }]);
  });
});

describe("firstReview", () => {
  const blocks = "<fixable-findings>\nRename `x`.\n</fixable-findings>\n<open-findings>\n<finding>One.</finding>\n</open-findings>";

  test("a reply with both findings blocks gives the Fixable findings, the Open findings and the draft", () => {
    const sut = makeSUT();

    assert.deepEqual(sut.firstReview(blocks), { fixableFindings: "Rename `x`.", openFindings: [{ text: "One." }] });
    assert.deepEqual(sut.firstReview("<fixable-findings>\n</fixable-findings>\n<open-findings>\n</open-findings>\n<pr-body>## Summary</pr-body>"), {
      openFindings: [],
      pullRequestDraft: "## Summary",
    });
  });

  test("a reply that lacks a findings block, or whose Open findings the Host cannot read, is unreadable", () => {
    const sut = makeSUT();

    assert.deepEqual(sut.firstReview("All clean.\n<promise>COMPLETE</promise>"), { openFindings: [], unreadable: true });
    assert.deepEqual(sut.firstReview("<open-findings>\n</open-findings>"), { openFindings: [], unreadable: true });
    assert.deepEqual(sut.firstReview("<fixable-findings>\n</fixable-findings>"), { openFindings: [], unreadable: true });
    assert.deepEqual(sut.firstReview("<fixable-findings>\n</fixable-findings>\n<open-findings>\n- a bullet\n</open-findings>"), { openFindings: [], unreadable: true });
  });
});

// MARK: - Helpers

function platform(name: string): Platform {
  return { name, folder: name, standards: `docs/standards-${name}.md`, agentBuildHint: `run \`make ${name}\``, verified: "", steps: async () => [] };
}

const project = { repo: "acme/Habitat", platforms: [platform("web"), platform("server")], image: { tools: "Node and Go" } };

const runOneOpenFindings: OpenFinding[] = [
  { text: "The streak resets at UTC midnight.", at: { path: "web/src/streak.ts", line: 12 } },
  { text: "No test covers a skipped day." },
];

function makeSUT(standards = ["Prefer value types."], comments: string[] = []) {
  const issue: Issue = { number: 7, title: "Fix streak", body: "Body", labels: [], openBlockers: 0, comments };
  return {
    fixableFindings,
    openFindings,
    answeredOpenFindings,
    firstReview,
    pullRequestDraft,
    prompt: () => reviewerPrompt({ project, issue, branch: "issue/7-fix-streak", base: "abc123", standards }),
    wrapUp: (open: OpenFinding[] = runOneOpenFindings, ending: Pick<FixRound, "findingsLeft" | "failed"> = {}) =>
      wrapUpPrompt({
        project,
        issue,
        branch: "issue/7-fix-streak",
        base: "abc123",
        standards,
        fixRound: { fixableFindings: "web/src/streak.ts:12: rename `x`.", openFindings: open, reviewedHead: "def456", ...ending },
      }),
  };
}
