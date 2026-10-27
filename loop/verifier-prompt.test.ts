import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Issue } from "./afk-loop.js";
import { verifierPrompt } from "./verifier-prompt.js";

describe("verifierPrompt", () => {
  test("names the issue, the branch, the final head and the Behavior check", () => {
    const prompt = makeSUT();

    assert.ok(prompt.startsWith("You are the Verifier for issue #212 of acme/shop, on branch `issue/212-add-task` at commit `4f1c2a9`."));
    assert.ok(prompt.includes("Your run is the Behavior check: drive the running app and report whether it does what the issue's Acceptance criteria say."));
  });

  test("carries the issue with its comments", () => {
    const prompt = makeSUT();

    assert.ok(prompt.includes("<issue>\n# Add a Task\n\n## Acceptance criteria\n\n- [ ] Tapping + opens the sheet\n\n<comment>\nKeep the sheet small.\n</comment>\n</issue>"));
  });

  test("reads the glossary and the diff against the base", () => {
    const prompt = makeSUT();

    assert.ok(prompt.includes("Read GLOSSARY.md and use its vocabulary"));
    assert.ok(prompt.includes("Read the branch diff, `git diff base-sha...HEAD`, to see what changed."));
  });

  test("uses the Verify skill as the Host restored it from the base", () => {
    const prompt = makeSUT();

    assert.ok(prompt.includes("The Host restored the `verify-shop` skill from `base-sha` before your run, so it may differ from the branch's copy. Use it as it is."));
    assert.ok(prompt.includes("Invoke the `verify-shop` skill with the Skill tool and read its feature map."));
  });

  test("makes no commits and no tracked changes, checked by the Host at the final head", () => {
    const prompt = makeSUT();

    assert.ok(prompt.includes("You change no tracked file and commit nothing; you may write outside the repo. After your run the Host checks HEAD is `4f1c2a9` and `git status` is clean"));
  });

  test("checks the tools before driving, and fixes the outcome rules", () => {
    const prompt = makeSUT();

    assert.ok(prompt.includes("Before you drive: confirm, with the skill, that Launch, Doctor, a screenshot and a video recording each work."));
    assert.ok(prompt.includes("FAIL: the app shows a checked criterion is not met, or the app crashes, at Launch or later. FAIL holds even if other criteria could not be checked."));
    assert.ok(prompt.includes("With no criterion observable in the app, the outcome is INCONCLUSIVE."));
  });

  test("drives the journeys of each Feature file the diff touches, a criterion beating an out-of-date journey", () => {
    const prompt = makeSUT();

    assert.ok(prompt.includes("Also check regressions: for each feature the diff touches that has a feature file, drive that file's journeys."));
    assert.ok(prompt.includes("Where a criterion from the issue and a journey disagree, the criterion holds: skip the journey as \"changed by this issue: feature file out of date\"."));
    assert.ok(prompt.includes("With none, drive with the skill's Drive commands alone"));
    assert.ok(prompt.includes("For an item only partly seen in the app, check the part that is, and say in `observed` which part was not seen."));
  });

  test("drafts no Feature files", () => {
    const prompt = makeSUT();

    assert.ok(prompt.includes("- Draft no Feature files."));
  });

  test("writes the Evidence manifest to the evidence folder, with the fixed set of reasons for skipping", () => {
    const prompt = makeSUT();

    assert.ok(prompt.includes("- Behavior evidence: copy the screenshots and video you choose into `/Users/admin/afk-evidence/`, flat, as `.png` and `.mp4`."));
    assert.ok(prompt.includes("Then write `/Users/admin/afk-evidence/manifest.json`, the Evidence manifest, in this shape:"));
    assert.ok(prompt.includes('"outcome": "PASS"'));
    assert.ok(prompt.includes('`why` is one of: "not observable in the app", "changed by this issue: feature file out of date", "not mapped in the feature file".'));
    assert.ok(prompt.includes("Record at most one video, at most 10 MB."));
  });

  test("ends with the completion signal", () => {
    const prompt = makeSUT();

    assert.ok(prompt.endsWith("End your reply with <promise>COMPLETE</promise>."));
  });
});

function makeSUT(): string {
  const issue: Issue = {
    number: 212,
    title: "Add a Task",
    body: "## Acceptance criteria\n\n- [ ] Tapping + opens the sheet",
    labels: ["ready-for-agent"],
    openBlockers: 0,
    comments: ["Keep the sheet small."],
  };
  return verifierPrompt({ repo: "acme/shop", issue, branch: "issue/212-add-task", base: "base-sha", head: "4f1c2a9", verifySkill: "verify-shop" });
}
