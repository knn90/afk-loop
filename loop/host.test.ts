import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { checkGh, findHost } from "./host.js";
import type { Platform } from "./platforms.js";

describe("findHost", () => {
  test("finds .sandcastle/loop.config.ts from the git root", () => {
    const root = makeRepo({ config: true });

    const host = findHost(root);

    assert.equal(host.repoRoot, root);
    assert.equal(host.configDir, `${root}/.sandcastle/`);
    assert.equal(host.configPath, `${root}/.sandcastle/loop.config.ts`);
  });

  test("finds the same config from a subfolder", () => {
    const root = makeRepo({ config: true });
    const subfolder = join(root, "ios", "Features");
    mkdirSync(subfolder, { recursive: true });

    const host = findHost(subfolder);

    assert.equal(host.repoRoot, root);
    assert.equal(host.configPath, `${root}/.sandcastle/loop.config.ts`);
  });

  test("runs git at the repo root, whatever folder it was found from", () => {
    const root = makeRepo({ config: true });
    const subfolder = join(root, "docs");
    mkdirSync(subfolder);

    assert.equal(findHost(subfolder).git("rev-parse", "--show-prefix").trim(), "");
  });

  test("a repo without the config says where it looked", () => {
    const root = makeRepo({ config: false });

    assert.throws(() => findHost(root), { message: `no ${root}/.sandcastle/loop.config.ts: afk-loop runs inside a repo that has one` });
  });

  test("outside a git repo it says so", () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "afk-loop-nogit-")));

    assert.throws(() => findHost(folder), { message: `${folder} is not in a git repo: afk-loop runs inside a repo that has .sandcastle/loop.config.ts` });
  });
});

describe("checkGh", () => {
  test("a Verify skill needs gh 2.99 or newer, with the fix", () => {
    assert.throws(() => checkGh([platform(), platform("verify-ios")], () => "gh version 2.86.0 (2026-01-21)\nhttps://github.com/cli/cli/releases/tag/v2.86.0\n"), {
      message: "gh 2.86.0 is older than 2.99, which the Verify skill needs: brew upgrade gh",
    });
  });

  test("passes with gh 2.99 or newer", () => {
    checkGh([platform("verify-ios")], () => "gh version 2.99.0 (2026-09-01)\n");
    checkGh([platform("verify-ios")], () => "gh version 3.0.1 (2026-10-01)\n");
  });

  test("without a Verify skill gh's version is not checked", () => {
    checkGh([platform()], () => assert.fail("gh's version was read"));
  });
});

// MARK: - Helpers

function platform(verifySkill?: string): Platform {
  return { name: "ios", folder: "ios", standards: "docs/standards-ios.md", agentBuildHint: "", verified: "", verifySkill, steps: async () => [] };
}

function makeRepo({ config }: { config: boolean }): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "afk-loop-host-")));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  if (config) {
    mkdirSync(join(root, ".sandcastle"));
    writeFileSync(join(root, ".sandcastle", "loop.config.ts"), "export default {};\n");
  }
  return root;
}
