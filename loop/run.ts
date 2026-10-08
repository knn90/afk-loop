import { parseArgs } from "node:util";
import { defaultCap, describeHandoff, runAfkLoop, type Outcome } from "./afk-loop.js";
import { githubTracker } from "./github-tracker.js";
import { check, checkTart, deleteLeftoverVms, loadHostEnv, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { checkRepoOnGitHub } from "./preflight.js";
import { sandcastleAgents } from "./sandcastle-agents.js";
import { routedTestRun } from "./test-run.js";

function report(outcome: Outcome): string {
  switch (outcome.kind) {
    case "handoff":
      return `handoff (${outcome.pullRequest ?? "no PR"}): ${describeHandoff(outcome).why}`;
    case "error":
      return `error: ${outcome.message}`;
    default:
      return outcome.kind;
  }
}

export function runOptions(args: readonly string[]): { cap: number } {
  const { values } = parseArgs({
    args: [...args],
    options: { cap: { type: "string", default: String(defaultCap) } },
  });
  const cap = Number(values.cap);
  check(Number.isInteger(cap) && cap > 0, "--cap must be a positive integer");
  return { cap };
}

export async function run(loop: Loop, host: Host, args: readonly string[]) {
  const { cap } = runOptions(args);
  loadHostEnv(host);
  checkTart(loop);
  await checkRepoOnGitHub(loop, host);
  deleteLeftoverVms(loop);

  const outcomes = await runAfkLoop({
    tracker: githubTracker(loop, host),
    agents: sandcastleAgents(loop, host),
    testRunner: routedTestRun(host),
    cap,
    platforms: loop.platforms,
  });
  if (outcomes.length === 0) console.log("No Eligible issue");
  for (const outcome of outcomes) console.log(`#${outcome.issue}: ${report(outcome)}`);
}
