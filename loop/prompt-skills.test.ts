import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue } from "./afk-loop.js";
import { implementerPrompt } from "./implementer-prompt.js";
import type { Platform } from "./platforms.js";
import { reviewerPrompt, wrapUpPrompt } from "./reviewer-prompt.js";
import { requiredSkills, skill } from "./skills-plugin.js";

describe("the skills the prompts name", () => {
  test("are the skills build-image checks for", () => {
    const named = new Set(everyPrompt().flatMap((prompt) => [...prompt.matchAll(/mattpocock-skills:([\w-]+)/g)].map((match) => match[1])));

    assert.deepEqual([...named].sort(), [...requiredSkills].sort());
  });

  test("can only be named from the checked list", () => {
    assert.equal(skill("tdd"), "mattpocock-skills:tdd");
    // @ts-expect-error a skill outside requiredSkills is not a RequiredSkill
    skill("triage");
  });
});

// MARK: - Helpers

const platform: Platform = { name: "web", folder: "web", standards: "docs/standards-web.md", agentBuildHint: "run `make web`", verified: "", steps: async () => [] };
const project = { repo: "acme/Habitat", platforms: [platform], image: {} };
const issue: Issue = { number: 7, title: "Fix streak", body: "Body", labels: [], openBlockers: 0 };
const branch = "issue/7-fix-streak";
const base = "abc123";

function everyPrompt(): string[] {
  return [
    implementerPrompt(project, issue, branch),
    reviewerPrompt({ project, issue, branch, base, standards: [] }),
    wrapUpPrompt({ project, issue, branch, base, fixRound: { fixableFindings: "Rename `x`.", openFindings: [], reviewedHead: "def456" } }),
  ];
}
