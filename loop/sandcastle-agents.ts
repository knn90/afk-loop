import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { claudeCode, createSandbox } from "@ai-hero/sandcastle";
import { issueBranchPrefix, type Agents, type Session, type WorktreeState } from "./afk-loop.js";
import { branchFileName, check, lines, logsDir, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { implementerPrompt } from "./implementer-prompt.js";
import { platformsChanged, type Platform } from "./platforms.js";
import { completionSignal } from "./prompt-parts.js";
import { drafterPrompt, pullRequestDraft } from "./drafter-prompt.js";
import { openFindings, reviewerPrompt } from "./reviewer-prompt.js";
import { revisionPrompt } from "./revision-prompt.js";
import { copyFileOut, guestExec, guestRepo, quote, repoExec, tartSandbox } from "./tart.js";

const sandcastleSyncBase = "refs/sandcastle/sync-base";
const guestBundle = "/tmp/sandbox-commits.bundle";

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

function mergeBaseBranch(host: Host, issueNumber: number, branch: string, baseBranch: string, base: string): { conflicts: string[] } {
  const head = commitAt(host, `refs/heads/${branch}`);
  if (succeeds(host, "merge-base", "--is-ancestor", base, head)) return { conflicts: [] };
  let tree: string;
  try {
    tree = host.git("merge-tree", "--write-tree", "--name-only", "--no-messages", head, base).trim();
  } catch (error) {
    const { status, stdout } = error as { status?: number; stdout?: string };
    if (status !== 1 || !stdout) throw error;
    return { conflicts: lines(stdout).slice(1) };
  }
  const merge = host.git("commit-tree", tree, "-p", head, "-p", base, "-m", `[#${issueNumber}] - Merge ${baseBranch} into ${branch}`).trim();
  host.git("update-ref", `refs/heads/${branch}`, merge, head);
  return { conflicts: [] };
}

interface AgentSandbox extends Omit<Session, "inspect"> {
  runAgent(name: string, logName: string, prompt: string): Promise<{ output: string; log: string }>;
  runAgentKeepingHead(name: string, logName: string, prompt: string): Promise<{ output: string; log: string }>;
  inspect(base: string, pushed?: string): Promise<WorktreeState>;
  remove(): Promise<void>;
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

  return {
    exec: repoExec(vm),
    runAgent,
    async runAgentKeepingHead(name, logName, prompt) {
      const kept = worktree("rev-parse", "HEAD");
      try {
        return await runAgent(name, logName, prompt);
      } finally {
        if (existsSync(worktree("rev-parse", "--path-format=absolute", "--git-path", "rebase-apply"))) worktree("am", "--quit");
        worktree("reset", "--hard", "--quiet", kept);
        worktree("clean", "-ffdxq");
      }
    },
    async inspect(base, pushed = base) {
      const head = await guestGit("rev-parse HEAD");
      const dirty = (await guestGit("status --porcelain --untracked-files=all")) !== "";
      await fetchFromSandbox(head);
      if (existsSync(worktree("rev-parse", "--path-format=absolute", "--git-path", "rebase-apply"))) worktree("am", "--quit");
      if (dirty) worktree("reset", "--quiet", head);
      else {
        worktree("reset", "--hard", "--quiet", head);
        worktree("clean", "-ffdxq");
      }
      await guestGit(`update-ref ${sandcastleSyncBase} HEAD`);
      const commitsAhead = Number(host.git("rev-list", "--count", `${pushed}..${head}`).trim());
      return { dirty, head, commitsAhead, platforms: await platformsChangedBetween(host, loop.platforms, base, head) };
    },
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
      const sandbox = await openSandbox(loop, host, loop.vms.issue(issue.number), branch, `#${issue.number}`);
      const agentRuns = { Implementer: 0, Reviewer: 0, Drafter: 0 };
      const logName = (role: keyof typeof agentRuns) => {
        agentRuns[role] += 1;
        return `issue-${issue.number}-${role.toLowerCase()}-${agentRuns[role]}`;
      };
      const runAgent = (role: keyof typeof agentRuns, prompt: string) => sandbox.runAgent(role, logName(role), prompt);

      return {
        exec: sandbox.exec,
        async implement(feedback) {
          await runAgent("Implementer", implementerPrompt(loop, issue, branch, feedback));
        },
        async review(feedback) {
          const changed = await platformsChangedBetween(host, loop.platforms, base, `refs/heads/${branch}`);
          const standards = changed.map((platform) => host.git("show", `${base}:${platform.standards}`).trim());
          const run = await runAgent("Reviewer", reviewerPrompt({ project: loop, issue, branch, base, standards, feedback }));
          return { log: run.log, openFindings: openFindings(run.output) };
        },
        async draft(testRun) {
          const run = await sandbox.runAgentKeepingHead("Drafter", logName("Drafter"), drafterPrompt({ repo: loop.repo, issue, branch, base, testRun }));
          return pullRequestDraft(run.output);
        },
        inspect: () => sandbox.inspect(base),
        async close() {
          await sandbox.close();
          const noCommits = host.git("rev-list", "--count", `${base}..refs/heads/${branch}`).trim() === "0";
          if (noCommits && !worktreePath(host, branch)) host.git("branch", "-D", branch);
        },
      };
    },

    async startRevision(pullRequest, comments) {
      const { branch, issue } = pullRequest;
      host.git("worktree", "prune");
      host.fetchFromGitHub(loop.repo, loop.baseBranch, branch);
      const base = commitAt(host, remoteBase(loop));
      const pushed = commitAt(host, `refs/remotes/origin/${branch}`);
      const local = `refs/heads/${branch}`;
      const path = worktreePath(host, branch);

      if (succeeds(host, "rev-parse", "--verify", "--quiet", local) && !isLeftover(host, branch)) {
        const unpushed = host.git("rev-list", "--count", `${pushed}..${local}`).trim() !== "0";
        if (unpushed || (path && !path.startsWith(worktreesDir(host)))) return { kind: "hand-work" };
      }
      if (path) host.git("worktree", "remove", "--force", path);
      host.git("update-ref", local, pushed);
      clearRunMarker(host, branch);

      const { conflicts } = mergeBaseBranch(host, issue.number, branch, loop.baseBranch, base);
      if (conflicts.length > 0) return { kind: "merge-conflict", files: conflicts };

      const sandbox = await openSandbox(loop, host, loop.vms.issue(issue.number), branch, `#${issue.number}`);
      const logName = (run: number) => `issue-${issue.number}-revision-${pullRequest.revision}-implementer-${run}`;
      let runs = 0;
      while (existsSync(`${logsDir(host)}${logName(runs + 1)}.log`)) runs += 1;
      return {
        kind: "session",
        session: {
          exec: sandbox.exec,
          close: sandbox.close,
          async revise(feedback) {
            runs += 1;
            const prompt = revisionPrompt({ project: loop, issue, pullRequest: pullRequest.number, branch, base, comments, feedback });
            return sandbox.runAgent("Implementer", logName(runs), prompt);
          },
          inspect: () => sandbox.inspect(base, pushed),
          async discard() {
            await sandbox.remove();
            host.git("update-ref", local, pushed);
          },
        },
      };
    },
  };
}
