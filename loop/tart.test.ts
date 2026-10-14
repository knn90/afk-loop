import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { envFileText, sandboxScript, writeSandboxEnvScript } from "./tart.js";

describe("the Sandbox env", () => {
  test("reaches a Sandbox command without being in its script", () => {
    const home = mkdtempSync(join(tmpdir(), "sandbox-home-"));
    const token = "sk-ant-oat01-it's-secret";
    zsh(home, writeSandboxEnvScript, envFileText({ CLAUDE_CODE_OAUTH_TOKEN: token }));

    const script = sandboxScript("printenv CLAUDE_CODE_OAUTH_TOKEN", { cwd: home });

    assert.equal(zsh(home, script).trim(), token);
    assert.ok(!script.includes("secret"));
  });

  test("missing, stops a Sandbox command before it runs", () => {
    const home = mkdtempSync(join(tmpdir(), "sandbox-home-"));

    assert.throws(() => zsh(home, sandboxScript("touch ran", { cwd: home })));
    assert.ok(!existsSync(join(home, "ran")));
  });

  test("is written to a file only its owner can read", () => {
    const home = mkdtempSync(join(tmpdir(), "sandbox-home-"));

    zsh(home, `umask 022; ${writeSandboxEnvScript}`, envFileText({ CLAUDE_CODE_OAUTH_TOKEN: "token" }));

    assert.equal(statSync(join(home, ".sandbox.env")).mode & 0o777, 0o600);
  });
});

function zsh(home: string, script: string, input?: string): string {
  return execFileSync("/bin/zsh", ["-c", script], { encoding: "utf8", input, stdio: ["pipe", "pipe", "ignore"], env: { PATH: process.env.PATH, HOME: home } });
}
