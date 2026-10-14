import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { envFileText, sandboxScript, writeSandboxEnvScript } from "./tart.js";

describe("the Sandbox env", () => {
  test("reaches a Sandbox command without being in its script", () => {
    const home = mkdtempSync(join(tmpdir(), "sandbox-home-"));
    const token = "sk-ant-oat01-it's-secret";
    bash(home, writeSandboxEnvScript, envFileText({ CLAUDE_CODE_OAUTH_TOKEN: token }));

    const script = sandboxScript("printenv CLAUDE_CODE_OAUTH_TOKEN", { cwd: home });

    assert.equal(bash(home, script).stdout.trim(), token);
    assert.ok(!script.includes("secret"));
  });

  test("missing, stops a Sandbox command before it runs", () => {
    const home = mkdtempSync(join(tmpdir(), "sandbox-home-"));

    assert.notEqual(bash(home, sandboxScript("touch ran", { cwd: home })).status, 0);
    assert.ok(!existsSync(join(home, "ran")));
  });

  test("is written to a file only its owner can read", () => {
    const home = mkdtempSync(join(tmpdir(), "sandbox-home-"));

    bash(home, `umask 022; ${writeSandboxEnvScript}`, envFileText({ CLAUDE_CODE_OAUTH_TOKEN: "token" }));

    assert.equal(statSync(join(home, ".sandbox.env")).mode & 0o777, 0o600);
  });
});

function bash(home: string, script: string, input?: string) {
  const result = spawnSync("/bin/bash", ["-c", script], { encoding: "utf8", input, env: { PATH: process.env.PATH, HOME: home } });
  if (result.error) throw result.error;
  return result;
}
