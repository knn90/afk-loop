import { check, checkTart, gh, loadHostEnv, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { checkRepoOnGitHub } from "./preflight.js";
import { platformsPresent, presentInSandbox } from "./platforms.js";
import { openSandbox, remoteBase } from "./sandcastle-agents.js";
import { routedTestRun } from "./test-run.js";

const branch = "sandcastle/smoke";
const subject = "[#0] - Smoke commit";

export async function smoke(loop: Loop, host: Host) {
  const deleteSmokeBranch = () => {
    if (host.git("branch", "--list", branch).trim()) host.git("branch", "-D", branch);
  };

  loadHostEnv(host);

  const issue = gh("issue", "view", String(loop.smokeIssue), "-R", loop.repo, "--json", "number,title", "-q", '"#\\(.number) \\(.title)"').trim();
  console.log(`Host gh: ${issue}`);

  checkTart(loop);
  await checkRepoOnGitHub(loop, host);
  deleteSmokeBranch();
  const base = host.git("rev-parse", remoteBase(loop)).trim();
  const sandbox = await openSandbox(loop, host, loop.vms.smoke, branch, "smoke");
  const testRunner = routedTestRun(host);

  try {
    const ghAuth = await sandbox.exec("gh auth status");
    check(ghAuth.exitCode !== 0, "Sandbox gh is authenticated");

    const commit = await sandbox.exec(`echo smoke > smoke.txt && git add smoke.txt && git commit --quiet -m '${subject}' && git rev-parse HEAD`);
    check(commit.exitCode === 0, `commit in the Sandbox failed: ${commit.output}`);
    const sandboxHead = commit.output.trim();

    const run = await sandbox.runAgent("Smoke agent", "smoke", [
      "Read GLOSSARY.md and list the skills you have from the mattpocock-skills plugin.",
      "Reply with the first line of GLOSSARY.md, then the number of those skills, then <promise>COMPLETE</promise>.",
      "Change no files.",
    ].join("\n"));
    check(run.output.includes("<promise>COMPLETE</promise>"), `agent did not complete, log: ${run.log}`);

    const returned = await sandbox.inspect(base);
    check(!returned.dirty, "agent left uncommitted changes");
    check(returned.head === sandboxHead && returned.commitsAhead === 1, "agent moved HEAD");
    check(host.git("rev-parse", branch).trim() === sandboxHead, "Host branch isn't at the Sandbox commit");
    check(host.git("log", "-1", "--format=%s", branch).trim() === subject, "commit subject changed on the way to the Host");

    const testRun = await testRunner.run(sandbox.exec, branch, await platformsPresent(loop.platforms, presentInSandbox(sandbox.exec)));
    check(testRun.passed, `Test run failed, log: ${testRunner.rawLogPath(branch)}\n${testRun.log}`);
    check(!(await sandbox.inspect(base)).dirty, "Test run left uncommitted changes");
    console.log("Smoke passed");
  } finally {
    await sandbox.remove();
    deleteSmokeBranch();
  }
}
