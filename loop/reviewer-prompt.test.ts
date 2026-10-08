import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue } from "./afk-loop.js";
import type { Platform } from "./platforms.js";
import { openFindings, reviewerPrompt } from "./reviewer-prompt.js";

describe("reviewerPrompt", () => {
  test("reads the glossary, and the glossary map when it exists", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Read GLOSSARY\.md and use its vocabulary; if GLOSSARY-MAP\.md exists, follow it to the context you change\./);
    assert.ok(!prompt.includes("CONTEXT"));
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
    assert.match(prompt, /Fix every Spec, Standards and Design finding/);
    assert.match(prompt, /a deepening that reaches beyond this diff, stays unfixed/);
  });

  test("the agent builds and tests in the Sandbox, and the loop's Test run decides", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(
      prompt.includes(
        "- This Sandbox is a macOS VM with Node and Go. Build and test your work before you finish: for `web/`, run `make web`; for `server/`, run `make server`. The loop's Test run follows your run and decides: it covers each of the two folders your branch changes, with any failures returned to you.",
      ),
    );
    assert.ok(!prompt.includes("container"));
  });

  test("asks for fixes committed in the issue's commit format", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Commit every fix on this branch as `\[#7\] - Imperative summary`/);
  });

  test("a run with host feedback fixes only that, without another review", () => {
    const sut = makeSUT();

    const prompt = sut.prompt("error: boom");

    assert.ok(!prompt.includes("code-review"));
    assert.ok(!prompt.includes("codebase-design"));
    assert.match(prompt, /Fix only what <host-feedback> reports/);
  });

  test("a first run carries no host feedback", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(!prompt.includes("<host-feedback>"));
  });

  test("host feedback precedes the instructions and its fixes are part of done", () => {
    const sut = makeSUT();

    const prompt = sut.prompt("error: boom");

    assert.ok(prompt.indexOf("<host-feedback>\nerror: boom\n</host-feedback>") < prompt.indexOf("How to work:"));
    assert.match(prompt, /Done means[^\n]*every failure in <host-feedback> is fixed/);
  });

  test("a review asks for each Open finding with its text and, where it has one, its path and line", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Every finding you left unfixed is an Open finding: the maintainer must decide it\./);
    assert.match(prompt, /between `<open-findings>` and `<\/open-findings>`[^\n]*`<finding path="path\/to\/file" line="12">[^\n]*<\/finding>`/);
    assert.match(prompt, /a line on the new side of `git diff abc123\.\.\.HEAD`[^\n]*Leave both out when the finding has no single line/);
    assert.match(prompt, /The Host posts each one as a review comment on the PR/);
  });

  test("a point the issue settles is not reported, and a real problem outside the issue's work is an Open finding", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /A point the <issue>'s own text settles is not a finding: do not report it\. A real problem that is not this issue's work is an Open finding\./);
  });

  test("a review asks for no count of Open findings and no list for the PR body", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(!prompt.includes("<open-findings>N"));
    assert.ok(!prompt.includes("unfixed-findings"));
  });
});

describe("reviewerPrompt, PR body", () => {
  test("a review drafts no PR body: that is the Drafter's", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(!prompt.includes("pr-body"));
    assert.match(prompt, /Done means every finding is fixed or answered, all committed/);
  });
});

describe("openFindings", () => {
  test("a finding with a path and a line is read with both", () => {
    const sut = makeSUT();

    const findings = sut.openFindings('Done.\n<open-findings>\n<finding path="web/src/streak.ts" line="12">The streak resets at UTC midnight.</finding>\n</open-findings>');

    assert.deepEqual(findings, [{ text: "The streak resets at UTC midnight.", at: { path: "web/src/streak.ts", line: 12 } }]);
  });

  test("a finding with no line is read as its text alone", () => {
    const sut = makeSUT();

    const findings = sut.openFindings('<open-findings>\n<finding>No test covers a\nskipped day.</finding>\n<finding path="web/src/streak.ts">Shallow module.</finding>\n</open-findings>');

    assert.deepEqual(findings, [{ text: "No test covers a\nskipped day." }, { text: "Shallow module." }]);
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

// MARK: - Helpers

function platform(name: string): Platform {
  return { name, folder: name, standards: `docs/standards-${name}.md`, agentBuildHint: `run \`make ${name}\``, verified: "", steps: async () => [] };
}

const project = { repo: "acme/Habitat", platforms: [platform("web"), platform("server")], image: { tools: "Node and Go" } };

function makeSUT(standards = ["Prefer value types."]) {
  const issue: Issue = { number: 7, title: "Fix streak", body: "Body", labels: [], openBlockers: 0 };
  return {
    openFindings,
    prompt: (feedback?: string) =>
      reviewerPrompt({ project, issue, branch: "issue/7-fix-streak", base: "abc123", standards, feedback }),
  };
}
