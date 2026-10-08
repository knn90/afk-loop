import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue, LinkedIssue } from "./afk-loop.js";
import type { Platform } from "./platforms.js";
import { implementerPrompt } from "./implementer-prompt.js";
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

// MARK: - Helpers

function platform(name: string): Platform {
  return { name, folder: name, standards: `docs/standards-${name}.md`, agentBuildHint: `run \`make ${name}\``, verified: "", steps: async () => [] };
}

const project = { repo: "acme/Habitat", platforms: [platform("web"), platform("server")], image: { tools: "Node and Go" } };

function makeSUT() {
  const issue: Issue = { number: 7, title: "Fix streak", body: "Body", labels: [], openBlockers: 0 };
  return {
    prompt: (feedback?: string, linkedIssues?: LinkedIssue[], forProject: Project = project) => implementerPrompt(forProject, { ...issue, linkedIssues }, "issue/7-fix-streak", feedback),
  };
}
