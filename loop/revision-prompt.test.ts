import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue, NumberedComment } from "./afk-loop.js";
import type { Platform } from "./platforms.js";
import { revisionPrompt } from "./revision-prompt.js";

describe("revisionPrompt", () => {
  test("reads the glossary, and the glossary map when it exists", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Read GLOSSARY\.md and use its vocabulary; if GLOSSARY-MAP\.md exists, follow it to the context you change\./);
    assert.ok(!prompt.includes("CONTEXT"));
  });

  test("the issue and the review comments precede the instructions", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(prompt.indexOf("<issue>\n# Fix streak\n\nBody\n</issue>") < prompt.indexOf("<review-comments>"));
    assert.ok(prompt.indexOf("</review-comments>") < prompt.indexOf("How to work:"));
  });

  test("an inline thread carries its id, file, line, diff hunk and replies", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(
      prompt,
      /<comment id="C1" path="Sources\/Streak\.swift" line="12">\n<diff-hunk>\n@@ -1 \+1 @@\n<\/diff-hunk>\n<said by="knn90">\nRename this\.\n<\/said>\n<said by="AFK loop">\nWhich name\?\n<\/said>\n<said by="knn90">\n`current`\n<\/said>\n<\/comment>/,
    );
  });

  test("a conversation comment carries its id and author alone", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /<comment id="C2">\n<said by="knn90">\nAdd a test for zero\.\n<\/said>\n<\/comment>/);
  });

  test("every comment gets a verdict before any edit", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Give every comment a verdict before you edit anything/);
    assert.ok(prompt.indexOf("verdict before you edit") < prompt.indexOf("`mattpocock-skills:tdd` skill"));
    for (const verdict of ["`fixed`", "`declined`", "`question`"]) assert.ok(prompt.includes(verdict));
  });

  test("names every platform's coding standards, to follow by the folder changed", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Follow the coding standards for the folder you change \(docs\/standards-web\.md for `web\/`, docs\/standards-server\.md for `server\/`\)/);
  });

  test("a comment is valid on three checks, in order", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    const applies = prompt.indexOf("still applies to the current code");
    const agrees = prompt.indexOf("agrees with the <issue>, those coding standards and GLOSSARY.md");
    const fixable = prompt.indexOf("belongs to this PR's change (`git diff abc123...HEAD`, plus any new file that change needs)");
    assert.ok(0 < applies && applies < agrees && agrees < fixable);
    assert.match(prompt, /contradicts them is `declined`, citing the rule/);
    assert.match(prompt, /hands the whole Revision off to the maintainer/);
  });

  test("fixed means every ask in the comment is fixed", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /`fixed`: valid, and every ask in the comment is fixed on this branch/);
    assert.match(prompt, /only some of them fixable: fix those, and give `declined` or `question` with a reply naming what remains/);
  });

  test("a run with host feedback keeps fixed for comments its earlier runs fixed", () => {
    const sut = makeSUT();

    const first = sut.prompt();
    const second = sut.prompt("error: boom");

    assert.ok(!first.includes("earlier runs"));
    assert.match(second, /no longer applies because one of those commits fixed it keeps `fixed`/);
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

  test("the host's part names the replies and the fixed threads, not a new PR", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /posts your replies on the PR and resolves the `fixed` threads once the branch is green/);
    assert.ok(!prompt.includes("opens the PR"));
  });

  test("a declined or questioned comment leaves the others to be worked", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Judge each comment on its own/);
  });

  test("valid comments are fixed through the tdd skill, without the Reviewer's skills", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Invoke the `mattpocock-skills:tdd` skill with the Skill tool/);
    assert.match(prompt, /changes behaviour gets its failing test first/);
    assert.ok(!prompt.includes("code-review"));
    assert.ok(!prompt.includes("codebase-design"));
  });

  test("the reply ends with one line per comment before the completion signal", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(
      prompt.endsWith(
        "<replies>\nC1 | fixed, declined or question | your reply, on one line\nC2 | fixed, declined or question | your reply, on one line\n</replies>\n<promise>COMPLETE</promise>",
      ),
    );
    assert.match(prompt, /one plain-text line for each of C1, C2/);
  });

  test("a first run carries no host feedback", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.ok(!prompt.includes("<host-feedback>"));
  });

  test("host feedback follows the comments and its fixes are part of done", () => {
    const sut = makeSUT();

    const prompt = sut.prompt("error: boom");

    assert.ok(prompt.indexOf("</review-comments>") < prompt.indexOf("<host-feedback>\nerror: boom\n</host-feedback>"));
    assert.ok(prompt.indexOf("</host-feedback>") < prompt.indexOf("How to work:"));
    assert.match(prompt, /Done means[^\n]*every failure in <host-feedback> is fixed/);
  });
});

// MARK: - Helpers

function platform(name: string): Platform {
  return { name, folder: name, standards: `docs/standards-${name}.md`, agentBuildHint: `run \`make ${name}\``, verified: "", steps: async () => [] };
}

const project = { repo: "acme/Habitat", platforms: [platform("web"), platform("server")], image: { tools: "Node and Go" } };

function makeSUT() {
  const issue: Issue = { number: 7, title: "Fix streak", body: "Body", labels: [], openBlockers: 0 };
  const comments: NumberedComment[] = [
    {
      id: "C1",
      kind: "inline",
      thread: "T1",
      author: "knn90",
      body: "Rename this.",
      path: "Sources/Streak.swift",
      line: 12,
      diffHunk: "@@ -1 +1 @@",
      replies: [
        { author: "AFK loop", body: "Which name?" },
        { author: "knn90", body: "`current`" },
      ],
    },
    { id: "C2", kind: "conversation", author: "knn90", body: "Add a test for zero.", replies: [] },
  ];
  return {
    prompt: (feedback?: string) =>
      revisionPrompt({ project, issue, pullRequest: 21, branch: "issue/7-fix-streak", base: "abc123", comments, feedback }),
  };
}
