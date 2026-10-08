import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue, LinkedIssue } from "./afk-loop.js";
import type { Platform } from "./platforms.js";
import { findingsLeft, implementerPrompt } from "./implementer-prompt.js";
import type { Project } from "./loop-config.js";

describe("implementerPrompt", () => {
  test("reads the glossary, and the glossary map when it exists", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Read GLOSSARY\.md and use its vocabulary; if GLOSSARY-MAP\.md exists, follow it to the context you change\./);
    assert.ok(!prompt.includes("CONTEXT"));
  });

  test("a first run carries no host feedback", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(!prompt.includes("<host-feedback>"));
  });

  test("an issue's linked issues follow it", () => {
    const sut = makeSUT();

    const prompt = sut.prompt(undefined, [{ number: 224, title: "Verify the stack", body: "Catalog", comments: [] }]);

    assert.match(prompt, /<\/issue>\n\n<linked-issue number="224">\n# Verify the stack\n\nCatalog\n<\/linked-issue>/);
  });

  test("the issue is worked through the tdd skill", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Invoke the `mattpocock-skills:tdd` skill with the Skill tool/);
  });

  test("names every platform's coding standards, to follow by the folder changed", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Follow the coding standards for the folder you change \(docs\/standards-web\.md for `web\/`, docs\/standards-server\.md for `server\/`\)/);
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

  test("a project with one platform and no tools named builds that folder alone", () => {
    const sut = makeSUT();

    const prompt = sut.prompt(undefined, undefined, { repo: "acme/Habitat", platforms: [platform("web")], image: {} });

    assert.match(prompt, /Follow the coding standards for the folder you change \(docs\/standards-web\.md for `web\/`\)/);
    assert.ok(
      prompt.includes(
        "- This Sandbox is a macOS VM. Build and test your work before you finish: for `web/`, run `make web`. The loop's Test run follows your run and decides: it covers `web/` when your branch changes it, with any failures returned to you.",
      ),
    );
  });

  test("host feedback follows the issue and its fixes are part of done", () => {
    const sut = makeSUT();

    const prompt = sut.prompt("error: boom");

    assert.ok(prompt.indexOf("</issue>") < prompt.indexOf("<host-feedback>\nerror: boom\n</host-feedback>"));
    assert.ok(prompt.indexOf("</host-feedback>") < prompt.indexOf("How to work:"));
    assert.match(prompt, /Done means[^\n]*every failure in <host-feedback> is fixed/);
  });
});

describe("implementerPrompt, Fix round", () => {
  const fixable = "web/src/streak.ts:12: rename `x`.";

  test("carries the Fixable findings as its feedback, as the one Fix round and not as a rejected run", () => {
    const sut = makeSUT();

    const prompt = sut.fix(fixable);

    assert.ok(
      prompt.includes(
        "</issue>\n\nYour work on this issue passed the Test run and the Reviewer reviewed it. This is your one Fix round: fix the Reviewer's Fixable findings.\n\n<host-feedback>\nweb/src/streak.ts:12: rename `x`.\n</host-feedback>\n\nHow to work:",
      ),
    );
    assert.ok(!prompt.includes("Your last run was rejected"));
  });

  test("asks for a block listing each finding it left and why", () => {
    const sut = makeSUT();

    const prompt = sut.fix(fixable);

    assert.ok(
      prompt.includes(
        "- You may leave a finding you judge wrong: change nothing for it. End your reply with each finding you left and why, between `<findings-left>` and `</findings-left>`. With none, leave the block empty. The Host passes the block to the Reviewer.",
      ),
    );
    assert.match(prompt, /Done means every finding in <host-feedback> is fixed or is in <findings-left> with why, all committed/);
  });

  test("fixes the findings alone", () => {
    const sut = makeSUT();

    const prompt = sut.fix(fixable);

    assert.ok(prompt.includes("- Fix only the findings in <host-feedback>, each with the test it needs. Add nothing else: the Reviewer reviews this round's commits once more, and nothing they add gets another Fix round."));
    assert.ok(!prompt.includes("every acceptance criterion"));
  });

  test("a rejected run in the Fix round follows the findings, and its fix is part of done", () => {
    const sut = makeSUT();

    const prompt = sut.fix(fixable, "error: boom");

    assert.ok(prompt.includes("<host-feedback>\nweb/src/streak.ts:12: rename `x`.\n\nYour last run in this Fix round was rejected. Fix this too:\n\nerror: boom\n</host-feedback>"));
    assert.match(prompt, /Done means every finding in <host-feedback> is fixed or is in <findings-left> with why, the rejection there is fixed, all committed/);
    assert.ok(prompt.includes("`<findings-left>` and `</findings-left>`"));
  });

  test("the first round asks for no such block", () => {
    const sut = makeSUT();

    assert.ok(!sut.prompt().includes("findings-left"));
    assert.ok(!sut.prompt("error: boom").includes("findings-left"));
  });
});

describe("findingsLeft", () => {
  test("a reply with the block gives its text", () => {
    assert.equal(findingsLeft("Done.\n<findings-left>\n1. `x` is the issue's own name.\n</findings-left>\n<promise>COMPLETE</promise>"), "1. `x` is the issue's own name.");
  });

  test("an empty block or a missing one gives none", () => {
    assert.equal(findingsLeft("<findings-left>\n</findings-left>"), undefined);
    assert.equal(findingsLeft("All fixed."), undefined);
  });

  test("the last block in the reply is the one read", () => {
    assert.equal(findingsLeft("They go in `<findings-left>…</findings-left>`.\n<findings-left>Left one.</findings-left>"), "Left one.");
  });
});

// MARK: - Helpers

function platform(name: string): Platform {
  return { name, folder: name, standards: `docs/standards-${name}.md`, agentBuildHint: `run \`make ${name}\``, verified: "", steps: async () => [] };
}

const project = { repo: "acme/Habitat", platforms: [platform("web"), platform("server")], image: { tools: "Node and Go" } };

function makeSUT() {
  const issue: Issue = { number: 7, title: "Fix streak", body: "Body", labels: [], openBlockers: 0 };
  return {
    prompt: (feedback?: string, linkedIssues?: LinkedIssue[], forProject: Project = project) => implementerPrompt(forProject, { ...issue, linkedIssues }, "issue/7-fix-streak", feedback),
    fix: (fixableFindings: string, feedback?: string) => implementerPrompt(project, issue, "issue/7-fix-streak", feedback, fixableFindings),
  };
}
