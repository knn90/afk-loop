import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkSkillsPlugin, installSkillsPlugin } from "./skills-plugin.js";

describe("installSkillsPlugin", () => {
  test("adds the marketplace at the pinned tag, then installs the plugin", () => {
    assert.deepEqual(installSkillsPlugin, [
      "claude plugin marketplace add 'mattpocock/skills#v1.3.1'",
      "claude plugin install mattpocock-skills@mattpocock",
    ]);
  });
});

describe("checkSkillsPlugin", () => {
  test("reports the pinned version when every required skill is there", async () => {
    const sut = makeSUT();

    const report = await checkSkillsPlugin(sut.guest);

    assert.equal(report, "skills plugin mattpocock-skills 1.3.1 (mattpocock/skills#v1.3.1) has tdd, code-review, codebase-design, pr");
  });

  test("fails when the plugin isn't installed", async () => {
    const sut = makeSUT({ plugins: [] });

    await assert.rejects(checkSkillsPlugin(sut.guest), { message: "mattpocock-skills@mattpocock is not installed" });
  });

  test("fails naming each required skill that is absent", async () => {
    const sut = makeSUT({ skills: allSkills.filter((path) => !path.endsWith("/pr") && !path.endsWith("/tdd")) });

    await assert.rejects(checkSkillsPlugin(sut.guest), { message: "skills plugin mattpocock-skills 1.3.1 lacks the required skills tdd, pr" });
  });

  test("a skill only named in a longer path doesn't count", async () => {
    const sut = makeSUT({ skills: [...allSkills.filter((path) => !path.endsWith("/pr")), "./skills/engineering/pr-draft"] });

    await assert.rejects(checkSkillsPlugin(sut.guest), /lacks the required skills pr$/);
  });

  test("fails when the installed version isn't the pinned one", async () => {
    const sut = makeSUT({ version: "1.4.0" });

    await assert.rejects(checkSkillsPlugin(sut.guest), { message: "skills plugin mattpocock-skills is 1.4.0, not the pinned 1.3.1" });
  });
});

// MARK: - Helpers

const allSkills = [
  "./skills/engineering/tdd",
  "./skills/engineering/triage",
  "./skills/engineering/codebase-design",
  "./skills/engineering/code-review",
  "./skills/engineering/pr",
];

const listed = [
  { id: "other@elsewhere", installPath: "/plugins/other" },
  { id: "mattpocock-skills@mattpocock", installPath: "/plugins/mattpocock-skills/1.3.1" },
];

function makeSUT({ plugins = listed, version = "1.3.1", skills = allSkills }: { plugins?: typeof listed; version?: string; skills?: readonly string[] } = {}) {
  const guest = async (script: string) => {
    if (script === "claude plugin list --json") return JSON.stringify(plugins);
    if (script === "cat '/plugins/mattpocock-skills/1.3.1/.claude-plugin/plugin.json'") return JSON.stringify({ name: "mattpocock-skills", version, skills });
    throw new Error(`unexpected guest script: ${script}`);
  };
  return { guest };
}
