import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { afkLoop, type Command } from "./cli.js";

describe("afkLoop", () => {
  for (const [name, ...args] of [["run", "--cap", "2"], ["smoke"], ["build-image"]] as const) {
    test(`${name} gets the repo's config and Host, from the repo root and from a subfolder`, async () => {
      const root = makeRepo();
      for (const cwd of [root, join(root, "android", "app")]) {
        const { commands, calls } = makeCommands();

        await afkLoop([name, ...args], { cwd, commands });

        assert.deepEqual(calls, [{ name, loop: "habitat", repoRoot: root, args }]);
      }
    });
  }

  test("smoke and build-image take no options", async () => {
    const { commands, calls } = makeCommands();

    await assert.rejects(afkLoop(["build-image", "--help"], { cwd: makeRepo(), commands }), { message: usage });
    await assert.rejects(afkLoop(["smoke", "--cap", "2"], { cwd: makeRepo(), commands }), { message: usage });
    assert.deepEqual(calls, []);
  });

  test("an unknown command lists the three", async () => {
    const { commands, calls } = makeCommands();

    await assert.rejects(afkLoop(["deploy"], { cwd: makeRepo(), commands }), { message: usage });
    await assert.rejects(afkLoop([], { cwd: makeRepo(), commands }), { message: usage });
    assert.deepEqual(calls, []);
  });

  test("a config that doesn't default-export defineLoop's result is refused", async () => {
    const root = makeRepo("export default { repo: \"acme/Habitat\" };\n");
    const { commands } = makeCommands();

    await assert.rejects(afkLoop(["smoke"], { cwd: root, commands }), { message: `${root}/.sandcastle/loop.config.ts must default-export defineLoop({ ... })` });
  });
});

// MARK: - Helpers

const usage = "usage: afk-loop run [--cap <n>] | smoke | build-image";

function makeRepo(config = 'export default { name: "habitat", vms: { base: "habitat-base" } };\n'): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "afk-loop-cli-")));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  mkdirSync(join(root, ".sandcastle"));
  mkdirSync(join(root, "android", "app"), { recursive: true });
  writeFileSync(join(root, ".sandcastle", "loop.config.ts"), config);
  return root;
}

function makeCommands() {
  const calls: { name: string; loop: string; repoRoot: string; args: readonly string[] }[] = [];
  const command =
    (name: string): Command =>
    async (loop, host, args) => {
      calls.push({ name, loop: loop.name, repoRoot: host.repoRoot, args });
    };
  return { commands: { run: command("run"), smoke: command("smoke"), "build-image": command("build-image") }, calls };
}
