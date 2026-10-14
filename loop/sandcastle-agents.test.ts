import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { hostAt } from "./host.js";
import { createIssueBranch } from "./sandcastle-agents.js";

describe("createIssueBranch", () => {
  test("starts the Issue branch at the base, not at a stale origin ref of the same name", () => {
    const host = hostAt(makeRepo());
    const base = commit(host.repoRoot, "base");
    const closedPullRequest = commit(host.repoRoot, "closed PR's work");
    host.git("update-ref", "refs/remotes/origin/issue/15-x", closedPullRequest);

    createIssueBranch(host, "issue/15-x", base);

    assert.equal(host.git("rev-parse", "refs/heads/issue/15-x").trim(), base);
  });

  test("leaves an existing local branch as it is and fails", () => {
    const host = hostAt(makeRepo());
    const base = commit(host.repoRoot, "base");
    const kept = commit(host.repoRoot, "kept work");
    host.git("branch", "issue/15-x", kept);

    assert.throws(() => createIssueBranch(host, "issue/15-x", base));
    assert.equal(host.git("rev-parse", "refs/heads/issue/15-x").trim(), kept);
  });
});

// MARK: - Helpers

function makeRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "afk-loop-agents-")));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  return root;
}

function commit(root: string, message: string): string {
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, encoding: "utf8" });
  git("commit", "--quiet", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD").trim();
}
