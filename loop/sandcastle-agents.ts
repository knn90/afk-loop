import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { claudeCode, createSandbox } from "@ai-hero/sandcastle";
import { issueBranchPrefix, type Agents, type Session, type VerifierRun, type WorktreeState } from "./afk-loop.js";
import type { EvidenceFile } from "./behavior-check.js";
import { hostEvidenceFolder } from "./evidence.js";
import { branchFileName, check, lines, logsDir, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { contradiction, findingsLeft, implementerPrompt } from "./implementer-prompt.js";
import { platformsChanged, verifySkillFolder, type Platform } from "./platforms.js";
import { completionSignal } from "./prompt-parts.js";
import { answeredOpenFindings, firstReview, pullRequestDraft, reviewerPrompt, wrapUpPrompt } from "./reviewer-prompt.js";
import { copyFileOut, copyFilesOut, guestEvidence, guestExec, guestRepo, quote, repoExec, tartSandbox } from "./tart.js";
import { verifierPrompt } from "./verifier-prompt.js";

const sandcastleSyncBase = "refs/sandcastle/sync-base";
const guestBundle = "/tmp/sandbox-commits.bundle";
const manifestFile = "manifest.json";

const worktreesDir = ({ configDir }: Host) => `${configDir}worktrees/`;
const runsDir = ({ configDir }: Host) => `${configDir}runs/`;

function runMarker(host: Host, branch: string): string {
  return `${runsDir(host)}${branchFileName(branch)}`;
}

function clearRunMarker(host: Host, branch: string) {
  rmSync(runMarker(host, branch), { force: true });
}

function worktreePath(host: Host, branch: string): string | undefined {
  const entries = host.git("worktree", "list", "--porcelain").split("\n\n").map(lines);
  const entry = entries.find((entry) => entry.includes(`branch refs/heads/${branch}`));
  return entry?.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
}

function isLeftover(host: Host, branch: string): boolean {
  const path = worktreePath(host, branch);
  return existsSync(runMarker(host, branch)) && (!path || path.startsWith(worktreesDir(host)));
}

function succeeds(host: Host, ...args: string[]): boolean {
  try {
    host.git(...args);
    return true;
  } catch {
    return false;
  }
}

function commitAt(host: Host, ref: string): string {
  return host.git("rev-parse", ref).trim();
}

function platformsChangedBetween(host: Host, platforms: readonly Platform[], base: string, head: string): Promise<Platform[]> {
  const changedPaths = lines(host.git("diff", "--name-only", "--no-renames", `${base}...${head}`));
  return platformsChanged(platforms, changedPaths, async (path) => succeeds(host, "cat-file", "-e", `${head}:${path}`));
}

export interface BehaviorCheckRun {
  readonly issueNumber: number;
  readonly verifySkill: string;
  readonly base: string;
  readonly head: string;
  readonly logName: string;
  readonly prompt: string;
}

interface AgentSandbox extends Omit<Session, "inspect"> {
  runAgent(name: string, logName: string, prompt: string): Promise<{ output: string; log: string }>;
  verify(run: BehaviorCheckRun): Promise<VerifierRun>;
  copyEvidenceOut(issueNumber: number, head: string): Promise<{ folder: string; files: EvidenceFile[] }>;
  inspect(base: string): Promise<WorktreeState>;
  putBack(head: string): Promise<void>;
  remove(): Promise<void>;
}

export function createIssueBranch(host: Host, branch: string, base: string) {
  host.git("branch", branch, base);
}

export function remoteBase({ baseBranch }: Loop): string {
  return `refs/remotes/origin/${baseBranch}`;
}

export async function openSandbox(loop: Loop, host: Host, vm: string, branch: string, label: string): Promise<AgentSandbox> {
  mkdirSync(runsDir(host), { recursive: true });
  writeFileSync(runMarker(host, branch), `${label}\n`);
  const sandbox = await createSandbox({
    branch,
    baseBranch: remoteBase(loop),
    cwd: host.repoRoot,
    sandbox: tartSandbox({ baseVm: loop.vms.base, vm }),
  });

  const githubEnv = await sandbox.exec("printenv GH_TOKEN GITHUB_TOKEN");
  if (githubEnv.stdout.trim() !== "") {
    await sandbox.close();
    throw new Error("Sandbox env has a GitHub token");
  }
  const worktree = (...args: string[]) => host.git("-C", sandbox.worktreePath, ...args).trim();
  const guestGit = async (args: string) => {
    const result = await guestExec(vm, `cd ${quote(guestRepo)} && git ${args}`);
    check(result.exitCode === 0, `git ${args} failed in the Sandbox: ${result.stderr}`);
    return result.stdout.trim();
  };
  const seed = worktree("rev-parse", "HEAD");
  for (const key of ["user.name", "user.email"]) await guestGit(`config ${key} ${quote(host.git("config", key).trim())}`);
  const fetchFromSandbox = async (head: string) => {
    check(/^[0-9a-f]{40}$/.test(head), `Sandbox HEAD is not a commit id: ${head}`);
    if (succeeds(host, "rev-parse", "--verify", "--quiet", `${head}^{commit}`)) return;
    const hostBundle = `${runMarker(host, branch)}.bundle`;
    await guestGit(`bundle create ${guestBundle} HEAD ^${seed}`);
    await copyFileOut(vm, guestBundle, hostBundle);
    host.git("-c", "fetch.fsckObjects=true", "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", hostBundle, "HEAD");
    rmSync(hostBundle);
  };
  const quitRebaseApply = () => {
    if (existsSync(worktree("rev-parse", "--path-format=absolute", "--git-path", "rebase-apply"))) worktree("am", "--quit");
  };
  const cleanWorktreeAt = (head: string) => {
    worktree("reset", "--hard", "--quiet", head);
    worktree("clean", "-ffdxq");
  };
  const guestShell = async (script: string) => {
    const result = await guestExec(vm, script);
    check(result.exitCode === 0, `${script} failed in the Sandbox: ${result.stderr}`);
    return result.stdout.trim();
  };
  const markSynced = () => guestGit(`update-ref ${sandcastleSyncBase} HEAD`);
  const close = async () => {
    await sandbox.close();
    clearRunMarker(host, branch);
  };

  const runAgent: AgentSandbox["runAgent"] = async (name, logName, prompt) => {
    const logPath = `${logsDir(host)}${logName}.log`;
    console.log(`${name} on ${label}, log: ${logPath}`);
    worktree("reset", "--hard", "--quiet");
    worktree("clean", "-ffdxq");
    const run = await sandbox.run({
      agent: claudeCode(loop.model),
      name: logName,
      logging: { type: "file", path: logPath },
      prompt,
      completionSignal,
    });
    return { output: run.stdout, log: relative(host.repoRoot, logPath) };
  };

  const evidenceFiles = async (): Promise<EvidenceFile[]> => {
    const listing = lines(await guestShell(`cd ${quote(guestEvidence)} && find . -maxdepth 1 -type f -exec stat -f '%z %N' {} +`));
    return listing.flatMap((line) => {
      const [, bytes, name] = /^(\d+) \.\/(.+)$/.exec(line) ?? [];
      return bytes && name ? [{ name, bytes: Number(bytes) }] : [];
    });
  };
  const copyEvidenceOut: AgentSandbox["copyEvidenceOut"] = async (issueNumber, head) => {
    const files = await evidenceFiles();
    const folder = hostEvidenceFolder(host, issueNumber, head);
    copyFilesOut(vm, guestEvidence, files.map(({ name }) => name), folder);
    return { folder, files };
  };

  const putBack: AgentSandbox["putBack"] = async (head) => {
    await guestGit(`reset --hard --quiet ${head}`);
    await guestGit("clean -ffdq");
    await markSynced();
    quitRebaseApply();
    cleanWorktreeAt(head);
  };

  return {
    exec: repoExec(vm),
    runAgent,
    copyEvidenceOut,
    async verify({ issueNumber, verifySkill, base, head, logName, prompt }) {
      const skillFolder = verifySkillFolder(verifySkill);
      await guestShell(`cd ${quote(guestRepo)} && rm -rf ${quote(skillFolder)} && git checkout ${base} -- ${quote(skillFolder)}`);
      await guestShell(`rm -rf ${quote(guestEvidence)} && mkdir -p ${quote(guestEvidence)}`);
      const run = await runAgent("Verifier", logName, prompt);
      const runHead = await guestGit("rev-parse HEAD");
      const dirty = (await guestGit(`status --porcelain --untracked-files=all -- . ${quote(`:(exclude)${skillFolder}`)}`)) !== "";
      const { folder, files } = await copyEvidenceOut(issueNumber, head);
      const manifest = files.some(({ name }) => name === manifestFile) ? readFileSync(`${folder}${manifestFile}`, "utf8") : undefined;
      if (!dirty && runHead === head) await putBack(head);
      return { log: run.log, evidence: `${relative(host.repoRoot, folder)}/`, ...(manifest === undefined ? {} : { manifest }), files: files.filter(({ name }) => name !== manifestFile), head: runHead, dirty };
    },
    async inspect(base) {
      const head = await guestGit("rev-parse HEAD");
      const dirty = (await guestGit("status --porcelain --untracked-files=all")) !== "";
      await fetchFromSandbox(head);
      quitRebaseApply();
      if (dirty) worktree("reset", "--quiet", head);
      else cleanWorktreeAt(head);
      await markSynced();
      const commitsAhead = Number(host.git("rev-list", "--count", `${base}..${head}`).trim());
      return { dirty, head, commitsAhead, platforms: await platformsChangedBetween(host, loop.platforms, base, head) };
    },
    putBack,
    close,
    async remove() {
      await close();
      const path = worktreePath(host, branch);
      if (path) host.git("worktree", "remove", "--force", path);
    },
  };
}

export function sandcastleAgents(loop: Loop, host: Host): Agents {
  return {
    async localBranches(issueNumber) {
      host.git("worktree", "prune");
      const branches = lines(host.git("branch", "--list", `${issueBranchPrefix(issueNumber)}*`, "--format=%(refname:short)"));
      return branches.map((name) => ({ name, leftover: isLeftover(host, name) }));
    },

    async discardLeftover(branch) {
      const path = worktreePath(host, branch);
      if (path) host.git("worktree", "remove", "--force", path);
      host.git("branch", "-D", branch);
      clearRunMarker(host, branch);
    },

    async start(issue, branch) {
      host.fetchFromGitHub(loop.repo, loop.baseBranch);
      const base = commitAt(host, remoteBase(loop));
      createIssueBranch(host, branch, base);
      const sandbox = await openSandbox(loop, host, loop.vms.issue(issue.number), branch, `#${issue.number}`);
      const agentRuns = { Implementer: 0, Reviewer: 0, Verifier: 0 };
      const logName = (role: keyof typeof agentRuns) => {
        agentRuns[role] += 1;
        return `issue-${issue.number}-${role.toLowerCase()}-${agentRuns[role]}`;
      };
      const runAgent = (role: keyof typeof agentRuns, prompt: string) => sandbox.runAgent(role, logName(role), prompt);
      const standards = async () => {
        const changed = await platformsChangedBetween(host, loop.platforms, base, `refs/heads/${branch}`);
        return changed.map((platform) => host.git("show", `${base}:${platform.standards}`).trim());
      };

      return {
        exec: sandbox.exec,
        async implement(feedback, fixableFindings) {
          const run = await runAgent("Implementer", implementerPrompt(loop, issue, branch, feedback, fixableFindings));
          return { reply: run.output, log: run.log, findingsLeft: findingsLeft(run.output), contradiction: contradiction(run.output) };
        },
        async review() {
          const run = await runAgent("Reviewer", reviewerPrompt({ project: loop, issue, branch, base, standards: await standards() }));
          return { log: run.log, ...firstReview(run.output) };
        },
        async wrapUp(fixRound) {
          const run = await runAgent("Reviewer", wrapUpPrompt({ project: loop, issue, branch, base, standards: await standards(), fixRound }));
          return { log: run.log, openFindings: answeredOpenFindings(run.output), pullRequestDraft: pullRequestDraft(run.output) };
        },
        async verify(verifySkill, head) {
          const prompt = verifierPrompt({ repo: loop.repo, issue, branch, base, head, verifySkill });
          return sandbox.verify({ issueNumber: issue.number, verifySkill, base, head, logName: logName("Verifier"), prompt });
        },
        putBack: sandbox.putBack,
        inspect: () => sandbox.inspect(base),
        async close() {
          await sandbox.close();
          const noCommits = host.git("rev-list", "--count", `${base}..refs/heads/${branch}`).trim() === "0";
          if (noCommits && !worktreePath(host, branch)) host.git("branch", "-D", branch);
        },
      };
    },
  };
}
