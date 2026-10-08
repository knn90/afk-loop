import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { SandboxExec, TestRunner } from "./afk-loop.js";
import { branchFileName, logsDir, type Host } from "./host.js";
import type { Platform } from "./platforms.js";
import { failedStepsSummary, type StepOutput } from "./test-log.js";

const timeoutMs = 30 * 60 * 1000;

function rawLogFile(host: Host, branch: string): string {
  return `${logsDir(host)}${branchFileName(branch)}-test-run.log`;
}

export async function runSteps(
  sandbox: SandboxExec,
  platforms: readonly Platform[],
  record: (text: string) => void,
): Promise<{ passed: boolean; log: string }> {
  const failures: StepOutput[] = [];
  for (const platform of platforms) {
    for (const step of await platform.steps(sandbox)) {
      const { exitCode, output } = await sandbox(step.command, { cwd: step.cwd, timeoutMs });
      record(`=== ${step.name}: ${step.command}\n${output}\n`);
      if (exitCode === 0) continue;
      failures.push({ name: step.name, output, format: step.format });
      await platform.afterFailure?.(sandbox, exitCode);
    }
  }
  return failures.length > 0 ? { passed: false, log: failedStepsSummary(failures) } : { passed: true, log: "" };
}

export const routedTestRun = (host: Host): TestRunner => ({
  async run(sandbox, branch, platforms) {
    const rawLog = rawLogFile(host, branch);
    mkdirSync(dirname(rawLog), { recursive: true });
    console.log(`Test run (${platforms.map((platform) => platform.name).join(", ")}) on ${branch}, log: ${rawLog}`);
    appendFileSync(rawLog, `\n##### Test run ${new Date().toISOString()}\n`);
    return runSteps(sandbox, platforms, (text) => appendFileSync(rawLog, text));
  },

  rawLogPath(branch) {
    return relative(host.repoRoot, rawLogFile(host, branch));
  },
});
