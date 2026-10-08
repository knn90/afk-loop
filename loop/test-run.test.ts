import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CommandResult, SandboxExec } from "./afk-loop.js";
import type { Platform, Step } from "./platforms.js";
import type { FailureFormat } from "./test-log.js";
import { runSteps } from "./test-run.js";

describe("runSteps", () => {
  test("runs each platform's steps from their folders, platform by platform", async () => {
    const { sut, commands } = makeSUT();

    const testRun = await sut.run([web, server]);

    assert.equal(testRun.passed, true);
    assert.deepEqual(commands, [
      { cwd: "web", command: "npm test" },
      { cwd: "web", command: "npm run build" },
      { cwd: "server", command: "go test ./..." },
    ]);
  });

  test("a platform's steps are asked of the Sandbox the Test run executes in", async () => {
    const { sut, commands } = makeSUT();

    await sut.run([listed]);

    assert.deepEqual(commands, [{ cwd: undefined, command: "ls" }, { cwd: "lib/a", command: "make" }, { cwd: "lib/b", command: "make" }]);
  });

  test("a failing step fails the Test run with its filtered output under its name, and the later steps still run", async () => {
    const { sut, commands } = makeSUT({ "npm test": { exitCode: 1, output: "noise\nFAIL: renders" } });

    const testRun = await sut.run([web, server]);

    assert.deepEqual(testRun, { passed: false, log: "## web tests\nFAIL: renders" });
    assert.deepEqual(commands.map(({ command }) => command), ["npm test", "cleanup 1", "npm run build", "go test ./..."]);
  });

  test("a platform without afterFailure goes on to its next step after a failure", async () => {
    const { sut, commands } = makeSUT({ "go test ./...": { exitCode: 2, output: "FAIL: handler" } });

    const testRun = await sut.run([server]);

    assert.equal(testRun.passed, false);
    assert.deepEqual(commands.map(({ command }) => command), ["go test ./..."]);
  });

  test("every step's raw output is recorded", async () => {
    const { sut, recorded } = makeSUT({ "go test ./...": { exitCode: 0, output: "ok" } });

    await sut.run([server]);

    assert.equal(recorded.join(""), "=== server: go test ./...\nok\n");
  });
});

// MARK: - Helpers

const format: FailureFormat = { line: /^FAIL/, blockHeader: /(?!)/, blockLine: /(?!)/ };
const step = (name: string, cwd: string, command: string): Step => ({ name, cwd, command, format });

function platform(name: string, overrides: Partial<Platform>): Platform {
  return { name, folder: name, standards: "", agentBuildHint: "", verified: "", steps: async () => [], ...overrides };
}

const web = platform("web", {
  steps: async () => [step("web tests", "web", "npm test"), step("web build", "web", "npm run build")],
  afterFailure: async (sandbox, exitCode) => void (await sandbox(`cleanup ${exitCode}`)),
});
const server = platform("server", { steps: async () => [step("server", "server", "go test ./...")] });
const listed = platform("lib", {
  async steps(sandbox) {
    const found = await sandbox("ls");
    return found.output.split("\n").filter(Boolean).map((dir) => step(dir, `lib/${dir}`, "make"));
  },
});

function makeSUT(results: Record<string, CommandResult> = {}) {
  const commands: { cwd?: string; command: string }[] = [];
  const recorded: string[] = [];
  const sandbox: SandboxExec = async (command, options) => {
    commands.push({ cwd: options?.cwd, command });
    if (command === "ls") return { exitCode: 0, output: "a\nb\n" };
    return results[command] ?? { exitCode: 0, output: "" };
  };
  const sut = { run: (platforms: Platform[]) => runSteps(sandbox, platforms, (text) => recorded.push(text)) };
  return { sut, commands, recorded };
}
