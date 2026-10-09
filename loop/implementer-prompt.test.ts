import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue, LinkedIssue } from "./afk-loop.js";
import type { Platform } from "./platforms.js";
import { contradiction, findingsLeft, implementerPrompt } from "./implementer-prompt.js";
import type { Project } from "./loop-config.js";

describe("implementerPrompt", () => {
  test("reads the glossary, and the glossary map when it exists", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Read GLOSSARY\.md and use its vocabulary; if GLOSSARY-MAP\.md exists, follow it to the glossary of the code you work on\./);
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

  test("an issue's comments follow its body inside the issue, one block each in posting order", () => {
    const sut = makeSUT();

    const prompt = sut.commented(["Use the weekly streak.", "Weeks start on Monday."]);

    assert.ok(prompt.includes("<issue>\n# Fix streak\n\nBody\n\n<comment>\nUse the weekly streak.\n</comment>\n\n<comment>\nWeeks start on Monday.\n</comment>\n</issue>"));
  });

  test("an issue with no comment is its title and body", () => {
    const sut = makeSUT();

    const prompt = sut.commented([]);

    assert.ok(prompt.includes("<issue>\n# Fix streak\n\nBody\n</issue>"));
  });

  test("comments are whole however long they are", () => {
    const sut = makeSUT();
    const long = "a".repeat(50_000);

    const prompt = sut.commented(["Use the daily streak.", long]);

    assert.ok(prompt.includes(`Body\n\n<comment>\nUse the daily streak.\n</comment>\n\n<comment>\n${long}\n</comment>\n</issue>`));
  });

  test("a comment that says which part holds is followed, and a Contradiction stops the work before any code", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(
      prompt.includes(
        "How to work:\n\n- First read the <issue> as one text: its body, then its <comment> blocks in posting order. Where a comment says which part holds, follow the comment. Two parts that disagree, with nothing saying which holds, are a Contradiction: write no code, commit nothing, and quote both parts in the <contradiction> block. The Host returns the issue to the maintainer.\n",
      ),
    );
  });

  test("the first round ends on the Contradiction block, empty when the issue has none", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(
      prompt.endsWith(
        "all committed, and `git status` is clean; or, on a Contradiction, nothing is committed and both parts are in the <contradiction> block. End your reply with this block, once, then <promise>COMPLETE</promise>. An empty block means the issue has no Contradiction. Write its tags nowhere else in your reply.\n\n<contradiction>\n</contradiction>",
      ),
    );
  });

  test("the issue is worked through the tdd skill", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Invoke the `mattpocock-skills:tdd` skill with the Skill tool and work the issue test-first with it: for each behaviour the issue asks for, a test/);
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

  test("carries the Fixable findings in their own block, as the one Fix round and not as a rejected run", () => {
    const sut = makeSUT();

    const prompt = sut.fix(fixable);

    assert.ok(
      prompt.includes(
        "</issue>\n\nYour work on this issue passed the Test run and the Reviewer reviewed it. This is your one Fix round: fix the Reviewer's Fixable findings.\n\n<fixable-findings>\nweb/src/streak.ts:12: rename `x`.\n</fixable-findings>\n\nHow to work:",
      ),
    );
    assert.ok(!prompt.includes("Your last run was rejected"));
    assert.ok(!prompt.includes("host-feedback"));
  });

  test("asks for a block listing each finding it left and why", () => {
    const sut = makeSUT();

    const prompt = sut.fix(fixable);

    assert.ok(
      prompt.includes(
        "- You may leave a finding you judge wrong: change nothing for it. List each finding you left in this Fix round, and why, in the <findings-left> block. The Host passes the block to the Reviewer.",
      ),
    );
    assert.ok(
      prompt.endsWith(
        "Done means every finding in <fixable-findings> is fixed or is in <findings-left> with why, all committed, and `git status` is clean. End your reply with this block, once, then <promise>COMPLETE</promise>. An empty block means you left none. Write its tags nowhere else in your reply.\n\n<findings-left>\n</findings-left>",
      ),
    );
    assert.equal(prompt.split("<promise>COMPLETE</promise>").length, 2);
  });

  test("fixes the findings alone", () => {
    const sut = makeSUT();

    const prompt = sut.fix(fixable);

    assert.ok(prompt.includes("- Fix only the findings in <fixable-findings>: the Reviewer reviews this round's commits once more, and nothing they add gets another Fix round."));
    assert.ok(prompt.includes("skill with the Skill tool and fix each finding test-first with it: where a fix changes behaviour, a test that would fail without it, in the test framework those standards name, then the fix."));
    assert.ok(!prompt.includes("each behaviour the issue asks for"));
    assert.ok(!prompt.includes("every acceptance criterion"));
  });

  test("the Fix round carries the issue's comments, and asks for no Contradiction", () => {
    const sut = makeSUT();

    const prompt = sut.fix("web/src/streak.ts:12: rename `x`.", undefined, ["Use the weekly streak."]);

    assert.ok(prompt.includes("Body\n\n<comment>\nUse the weekly streak.\n</comment>\n</issue>"));
    assert.ok(!/contradiction/i.test(prompt));
  });

  test("a rejected run in the Fix round follows the findings, and its fix is part of done", () => {
    const sut = makeSUT();

    const prompt = sut.fix(fixable, "error: boom");

    assert.ok(
      prompt.includes(
        "<fixable-findings>\nweb/src/streak.ts:12: rename `x`.\n</fixable-findings>\n\nYour last run in this Fix round was rejected; its commits are on this branch. Fix this too:\n\n<host-feedback>\nerror: boom\n</host-feedback>\n\nHow to work:",
      ),
    );
    assert.match(prompt, /Done means every finding in <fixable-findings> is fixed or is in <findings-left> with why, every failure in <host-feedback> is fixed, all committed/);
    assert.ok(prompt.endsWith("<findings-left>\n</findings-left>"));
  });

  test("the first round asks for no such block", () => {
    const sut = makeSUT();

    assert.ok(!sut.prompt().includes("findings-left"));
    assert.ok(!sut.prompt("error: boom").includes("findings-left"));
  });
});

describe("contradiction", () => {
  test("a reply with the block gives its text", () => {
    assert.equal(contradiction("Stopped.\n<contradiction>\nThe body says daily. The comment says weekly.\n</contradiction>\n<promise>COMPLETE</promise>"), "The body says daily. The comment says weekly.");
  });

  test("an empty block or a missing one gives none", () => {
    assert.equal(contradiction("Done.\n<contradiction>\n</contradiction>\n<promise>COMPLETE</promise>"), undefined);
    assert.equal(contradiction("Done."), undefined);
  });
});

describe("findingsLeft", () => {
  test("a reply with the block gives its text", () => {
    assert.equal(findingsLeft("Done.\n<findings-left>\n1. `x` is the issue's own name.\n</findings-left>\n<promise>COMPLETE</promise>"), "1. `x` is the issue's own name.");
  });

  test("an empty block or a missing one gives none", () => {
    assert.equal(findingsLeft("<findings-left>\n</findings-left>"), undefined);
    assert.equal(findingsLeft("All fixed."), undefined);
    assert.equal(findingsLeft("<findings-left>\nNone.\n</findings-left>"), undefined);
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
    commented: (comments: string[], body = issue.body) => implementerPrompt(project, { ...issue, body, comments }, "issue/7-fix-streak"),
    fix: (fixableFindings: string, feedback?: string, comments: string[] = []) => implementerPrompt(project, { ...issue, comments }, "issue/7-fix-streak", feedback, fixableFindings),
  };
}
