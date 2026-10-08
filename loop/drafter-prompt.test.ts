import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue } from "./afk-loop.js";
import { drafterPrompt, pullRequestDraft } from "./drafter-prompt.js";

describe("drafterPrompt", () => {
  test("reads the glossary, and the glossary map when it exists", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Read GLOSSARY\.md and use its vocabulary; if GLOSSARY-MAP\.md exists, follow it to the context you change\./);
    assert.ok(!prompt.includes("CONTEXT"));
  });

  test("names the pr skill, the diff range and the reply tags", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /`mattpocock-skills:pr` skill[^\n]*`git diff abc123\.\.\.HEAD`/);
    assert.match(prompt, /Done means the draft is in your reply between `<pr-body>` and `<\/pr-body>`/);
  });

  test("inlines the issue and what the Test run verified", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /<issue>\n# Fix streak\n\nBody\n<\/issue>/);
    assert.match(prompt, /<test-run>\nVerified: the Test run passed\.\n<\/test-run>/);
  });

  test("the draft starts at the Summary and leaves the Closes line to the Host", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /starts at `## Summary`[^\n]*`Refs #n`[^\n]*The Host puts `Closes #7\.` above it/);
  });

  test("Evidence is the Test run and output the Drafter ran itself", () => {
    const sut = makeSUT();

    const prompt = sut.prompt();

    assert.match(prompt, /Evidence[^\n]*<test-run>[^\n]*only output of commands you run in this Sandbox/);
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

// MARK: - Helpers

function makeSUT() {
  const issue: Issue = { number: 7, title: "Fix streak", body: "Body", labels: [], openBlockers: 0 };
  return {
    pullRequestDraft,
    prompt: () => drafterPrompt({ repo: "acme/Habitat", issue, branch: "issue/7-fix-streak", base: "abc123", testRun: "Verified: the Test run passed." }),
  };
}
