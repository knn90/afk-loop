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
  const path = process.env.PATH;
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nconsole.log("https://github.com/acme/Habitat/pull/9");\n`,
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
  };
}
