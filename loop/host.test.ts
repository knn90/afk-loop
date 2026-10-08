import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { findHost } from "./host.js";

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

// MARK: - Helpers

function makeRepo({ config }: { config: boolean }): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "afk-loop-host-")));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  if (config) {
    mkdirSync(join(root, ".sandcastle"));
    writeFileSync(join(root, ".sandcastle", "loop.config.ts"), "export default {};\n");
  }
  return root;
}
