import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defineLoop, leftoverVms } from "./loop-config.js";

describe("defineLoop", () => {
  test("every VM name is derived from the project's name", () => {
    const loop = defineLoop({ ...config, name: "habitat" });

    assert.equal(loop.vms.base, "habitat-base");
    assert.equal(loop.vms.issue(42), "habitat-issue-42");
    assert.equal(loop.vms.smoke, "habitat-smoke");
  });

  test("the name defaults to the repo's name in lowercase", () => {
    const loop = defineLoop({ ...config, repo: "acme/HabitAt" });

    assert.equal(loop.name, "habitat");
    assert.equal(loop.vms.base, "habitat-base");
  });

  test("the base branch and model are loop defaults a config may override", () => {
    const defaults = defineLoop(config);
    const overridden = defineLoop({ ...config, baseBranch: "develop", model: "claude-sonnet-5-5" });

    assert.equal(defaults.baseBranch, "main");
    assert.equal(defaults.model, "claude-opus-5-5");
    assert.equal(overridden.baseBranch, "develop");
    assert.equal(overridden.model, "claude-sonnet-5-5");
  });

  test("an override left undefined keeps the loop default", () => {
    const loop = defineLoop({ ...config, baseBranch: undefined, model: undefined });

    assert.equal(loop.baseBranch, "main");
    assert.equal(loop.model, "claude-opus-5-5");
  });
});

describe("leftoverVms", () => {
  test("are only this project's issue Sandboxes", () => {
    const loop = defineLoop({ ...config, name: "habit" });

    const leftovers = leftoverVms(loop, ["habit-base", "habit-smoke", "habit-issue-4", "habitat-issue-5", "garden-issue-6", "habit-issue-7", "habit-issue-notes"]);

    assert.deepEqual(leftovers, ["habit-issue-4", "habit-issue-7"]);
  });
});

// MARK: - Helpers

const config = {
  repo: "acme/Habitat",
  image: { source: "ghcr.io/acme/macos:1", cpus: 4, memoryMb: 4096, provision: [] },
  smokeIssue: 3,
  platforms: [],
};
