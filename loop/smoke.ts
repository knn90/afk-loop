import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import type { Issue } from "./afk-loop.js";
import { behaviorSection, hostReads } from "./behavior-check.js";
import { check, checkTart, gh, loadHostEnv, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { checkRepoOnGitHub } from "./preflight.js";
import { platformsPresent, presentInSandbox, verifySkills } from "./platforms.js";
import { openSandbox, remoteBase } from "./sandcastle-agents.js";
import { guestEvidence } from "./tart.js";
import { routedTestRun } from "./test-run.js";
import { verifierPrompt } from "./verifier-prompt.js";

const branch = "sandcastle/smoke";
const subject = "[#0] - Smoke commit";
const bigFile = "smoke-10mb.bin";

export async function smoke(loop: Loop, host: Host) {
  const deleteSmokeBranch = () => {
    if (host.git("branch", "--list", branch).trim()) host.git("branch", "-D", branch);
  };

  loadHostEnv(host);

  const issue: Issue = { ...JSON.parse(gh("issue", "view", String(loop.smokeIssue), "-R", loop.repo, "--json", "number,title,body")), labels: [], openBlockers: 0 };
  console.log(`Host gh: #${issue.number} ${issue.title}`);

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

    const present = await platformsPresent(loop.platforms, presentInSandbox(sandbox.exec));
    const testRun = await testRunner.run(sandbox.exec, branch, present);
    check(testRun.passed, `Test run failed, log: ${testRunner.rawLogPath(branch)}\n${testRun.log}`);
    check(!(await sandbox.inspect(base)).dirty, "Test run left uncommitted changes");

    const made = await sandbox.exec(`rm -rf ${guestEvidence} && mkdir -p ${guestEvidence} && head -c ${10 * 1024 * 1024} /dev/urandom > ${guestEvidence}/${bigFile} && shasum -a 256 ${guestEvidence}/${bigFile}`);
    check(made.exitCode === 0, `making a 10 MB file in the Sandbox failed: ${made.output}`);
    const started = Date.now();
    const copied = await sandbox.copyEvidenceOut(issue.number, sandboxHead);
    const seconds = (Date.now() - started) / 1000;
    const hostSha = createHash("sha256").update(readFileSync(`${copied.folder}${bigFile}`)).digest("hex");
    check(made.output.startsWith(hostSha), `10 MB file changed on its way out of the Sandbox: ${copied.folder}${bigFile}`);
    console.log(`Copied a 10 MB file out over scp in ${seconds}s`);
    rmSync(copied.folder, { recursive: true, force: true });

    const [verifySkill] = verifySkills(present);
    if (verifySkill) {
      const prompt = verifierPrompt({ repo: loop.repo, issue, branch, base, head: sandboxHead, verifySkill });
      const verifier = await sandbox.verify({ issueNumber: issue.number, verifySkill, base, head: sandboxHead, logName: "smoke-verifier", prompt });
      check(!verifier.dirty && verifier.head === sandboxHead, `Verifier changed the branch, log: ${verifier.log}`);
      check(verifier.manifest !== undefined, `Verifier wrote no Evidence manifest, log: ${verifier.log}`);
      console.log(behaviorSection({ ...hostReads(verifier.manifest, sandboxHead, verifier.files), head: sandboxHead, verifySkill, log: verifier.log, evidence: verifier.evidence }));
    } else {
      console.log("Verifier skipped: no present Platform has a Verify skill");
    }
    console.log("Smoke passed");
  } finally {
    await sandbox.remove();
    deleteSmokeBranch();
  }
}
