import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue } from "./afk-loop.js";
import type { Platform } from "./platforms.js";
import { hasOpenFindings, reviewerPrompt, unfixedFindings } from "./reviewer-prompt.js";

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
  test("a review asks for the list of findings left unfixed", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /List every finding you left unfixed[^\n]*`<unfixed-findings>`/);
  });

  test("a review asks for the count of findings the maintainer must decide", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /open when the maintainer must decide it[^\n]*the <issue> itself settles[^\n]*a later issue[^\n]*not open/);
    assert.match(prompt, /End your reply with `<open-findings>N<\/open-findings>`, N being the number of open findings/);
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

describe("unfixedFindings", () => {
  test("a reply listing findings gives the list", () => {
    const sut = makeSUT();

    const unfixed = sut.unfixedFindings("Done.\n<unfixed-findings>\n- Stock theme: belongs to #231.\n</unfixed-findings>\n<open-findings>0</open-findings>");

    assert.equal(unfixed, "- Stock theme: belongs to #231.");
  });

  test("a reply with no list gives none", () => {
    const sut = makeSUT();

    const unfixed = sut.unfixedFindings("All fixed.\n<open-findings>0</open-findings>");

    assert.equal(unfixed, undefined);
  });

  test("an empty list gives none", () => {
    const sut = makeSUT();

    const unfixed = sut.unfixedFindings("<unfixed-findings>\n</unfixed-findings>");

    assert.equal(unfixed, undefined);
  });

  test("the last list in the reply is the one given", () => {
    const sut = makeSUT();

    const unfixed = sut.unfixedFindings("I list them in `<unfixed-findings>…</unfixed-findings>`.\n<unfixed-findings>- One.</unfixed-findings>");

    assert.equal(unfixed, "- One.");
  });
});

describe("hasOpenFindings", () => {
  test("a reply counting zero has none", () => {
    const sut = makeSUT();

    const open = sut.hasOpenFindings("All fixed.\n<open-findings>0</open-findings>\n<promise>COMPLETE</promise>");

    assert.equal(open, false);
  });

  test("a reply counting some has open findings", () => {
    const sut = makeSUT();

    const open = sut.hasOpenFindings("Declined one.\n<open-findings>1</open-findings>");

    assert.equal(open, true);
  });

  test("a reply giving no count has open findings", () => {
    const sut = makeSUT();

    const open = sut.hasOpenFindings("Done.");

    assert.equal(open, true);
  });

  test("the last count in the reply decides", () => {
    const sut = makeSUT();

    const open = sut.hasOpenFindings("I end with `<open-findings>0</open-findings>` when clean.\n<open-findings>2</open-findings>");

    assert.equal(open, true);
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
    hasOpenFindings,
    unfixedFindings,
    prompt: (feedback?: string) =>
      reviewerPrompt({ project, issue, branch: "issue/7-fix-streak", base: "abc123", standards, feedback }),
  };
}
