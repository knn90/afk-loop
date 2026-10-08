import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { githubTracker } from "./github-tracker.js";
import { hostAt } from "./host.js";
import { defineLoop } from "./loop-config.js";

describe("githubTracker", () => {
  const sut = makeSUT();
  before(sut.install);
  after(sut.uninstall);

  test("a PR is opened on the project's repo, against its base branch", async () => {
    const tracker = githubTracker(defineLoop({ ...config, baseBranch: "develop" }), hostAt(tmpdir()));

    const pullRequest = await tracker.openPullRequest({ branch: "issue/4-streak", title: "[#4] - Streak", body: "Closes #4.", label: "ready-for-human" });

    assert.equal(pullRequest, "https://github.com/acme/Habitat/pull/9");
    assert.deepEqual(sut.calls(), [["pr", "create", "-R", "acme/Habitat", "--base", "develop", "--head", "issue/4-streak", "--title", "[#4] - Streak", "--body", "Closes #4.", "--label", "ready-for-human"]]);
  });

  test("a review is posted on the PR as a comment, its findings on their paths and lines of the new side", async () => {
    const tracker = githubTracker(defineLoop(config), hostAt(tmpdir()));

    await tracker.postReview("https://github.com/acme/Habitat/pull/9", {
      body: "No test covers a skipped day.",
      comments: [{ path: "web/src/streak.ts", line: 12, body: "The streak resets at UTC midnight." }],
    });

    assert.deepEqual(sut.calls().at(-1), ["api", "--method", "POST", "repos/acme/Habitat/pulls/9/reviews", "--input", "-"]);
    assert.deepEqual(sut.inputs().at(-1), {
      event: "COMMENT",
      body: "No test covers a skipped day.",
      comments: [{ path: "web/src/streak.ts", line: 12, side: "RIGHT", body: "The streak resets at UTC midnight." }],
    });
  });

  test("a review with every finding in its body is posted with no inline comment", async () => {
    const tracker = githubTracker(defineLoop(config), hostAt(tmpdir()));

    await tracker.postReview("https://github.com/acme/Habitat/pull/9", { body: "- `web/src/streak.ts:12`: The streak resets at UTC midnight.", comments: [] });

    assert.deepEqual(sut.inputs().at(-1), { event: "COMMENT", body: "- `web/src/streak.ts:12`: The streak resets at UTC midnight.", comments: [] });
  });

  test("a review GitHub rejects fails", async () => {
    const tracker = githubTracker(defineLoop(config), hostAt(tmpdir()));

    const posting = tracker.postReview("https://github.com/acme/Habitat/pull/9", { body: "", comments: [{ path: "web/gone.ts", line: 1, body: "Unprocessable" }] });

    await assert.rejects(posting);
  });
});

// MARK: - Helpers

const config = {
  repo: "acme/Habitat",
  image: { source: "ghcr.io/acme/macos:1", cpus: 4, memoryMb: 4096, provision: [] },
  smokeIssue: 3,
  platforms: [],
};

function makeSUT() {
  const bin = mkdtempSync(join(tmpdir(), "fake-gh-"));
  const log = join(bin, "calls.jsonl");
  const inputs = join(bin, "inputs.jsonl");
  const path = process.env.PATH;
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args.includes("--input")) {
  const input = fs.readFileSync(0, "utf8");
  fs.appendFileSync(${JSON.stringify(inputs)}, input + "\\n");
  if (input.includes("Unprocessable")) process.exit(1);
}
console.log("https://github.com/acme/Habitat/pull/9");
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  return {
    install: () => {
      process.env.PATH = `${bin}:${path}`;
    },
    uninstall: () => {
      process.env.PATH = path;
      rmSync(bin, { recursive: true });
    },
    calls: (): string[][] => readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    inputs: (): unknown[] => readFileSync(inputs, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)),
  };
}
