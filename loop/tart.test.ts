import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { sandboxEnvFile, sandboxEnvScripts } from "./tart.js";

describe("sandboxEnvScripts", () => {
  test("hands the Sandbox env to a Sandbox command through stdin, never through a script", () => {
    const home = newHome();
    const token = "sk-ant-oat01-it's-secret";
    const scripts = sandboxEnvScripts({ CLAUDE_CODE_OAUTH_TOKEN: token });
    const command = scripts.exec("printenv CLAUDE_CODE_OAUTH_TOKEN", { cwd: home });

    bash(home, scripts.write.script, scripts.write.stdin);

    assert.equal(bash(home, command).stdout.trim(), token);
    assert.ok(!`${scripts.write.script}\n${command}`.includes("secret"));
  });

  test("writes the Sandbox env to a file only its owner can read", () => {
    const home = newHome();
    const { write } = sandboxEnvScripts({ CLAUDE_CODE_OAUTH_TOKEN: "token" });

    bash(home, `umask 022; ${write.script}`, write.stdin);

    assert.equal(statSync(sandboxEnvFile.replace("~", home)).mode & 0o777, 0o600);
  });

  test("stops a Sandbox command when the Sandbox env file is missing", () => {
    const home = newHome();

    const result = bash(home, sandboxEnvScripts({}).exec("touch ran", { cwd: home }));

    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(join(home, "ran")));
  });
});

function newHome(): string {
  return mkdtempSync(join(tmpdir(), "sandbox-home-"));
}

function bash(home: string, script: string, input?: string) {
  const result = spawnSync("/bin/bash", ["-c", script], { encoding: "utf8", input, env: { PATH: process.env.PATH, HOME: home } });
  if (result.error) throw result.error;
  return result;
}
