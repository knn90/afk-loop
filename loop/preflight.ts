import { gh, lines, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { readyForAgent, readyForHuman } from "./loop-rules.js";
import { verifySkillFile, verifySkills, type Platform } from "./platforms.js";
import { gitIdentity, remoteBase } from "./sandcastle-agents.js";

export interface RepoRequirements {
  readonly repo: string;
  readonly baseBranch: string;
  readonly platforms: readonly Platform[];
}

export interface RepoProbe {
  isOnBase(path: string): Promise<boolean>;
  labels(): Promise<string[]>;
  gitConfigValue(key: string): Promise<string>;
}

const requiredFiles = ["GLOSSARY.md", "docs/agents/git-conventions.md"];
const requiredLabels = [readyForAgent, readyForHuman];
const gitIdentityExamples: Record<(typeof gitIdentity)[number], string> = { "user.name": "<your name>", "user.email": "<your email>" };

export async function checkRepo({ repo, baseBranch, platforms }: RepoRequirements, probe: RepoProbe) {
  const files = [
    ...requiredFiles,
    ...platforms.map((platform) => platform.standards),
    ...verifySkills(platforms).map(verifySkillFile),
  ];
  const missingFiles = await absent(files, probe.isOnBase);
  const labels = (await probe.labels()).map((label) => label.toLowerCase());
  const missingGitIdentity = await absent(gitIdentity, async (key) => (await probe.gitConfigValue(key)) !== "");
  const missing = [
    ...missingFiles.map((path) => `${path} missing on origin/${baseBranch}: add it and push it to ${baseBranch}`),
    ...requiredLabels.filter((label) => !labels.includes(label)).map((label) => `label ${label} missing: gh label create ${label} -R ${repo}`),
    ...missingGitIdentity.map((key) => `git ${key} not set: git config ${key} "${gitIdentityExamples[key]}"`),
  ];
  if (missing.length === 0) return;
  throw new Error([`${repo} lacks what the loop requires; nothing started:`, ...missing.map((thing) => `- ${thing}`), "What a repo needs: afk-loop's README.md#what-a-repo-needs"].join("\n"));
}

async function absent<T>(items: readonly T[], isPresent: (item: T) => Promise<boolean>): Promise<T[]> {
  const present = await Promise.all(items.map(isPresent));
  return items.filter((_, index) => !present[index]);
}

export function onRef(git: (...args: string[]) => string, ref: string): RepoProbe["isOnBase"] {
  return async (path) => lines(git("ls-tree", "--name-only", ref, "--", path)).includes(path);
}

export function fromGitConfig(git: (...args: string[]) => string): RepoProbe["gitConfigValue"] {
  return async (key) => {
    try {
      return git("config", key).trim();
    } catch (error) {
      if ((error as { status?: unknown }).status === 1) return "";
      throw error;
    }
  };
}

export async function checkRepoOnGitHub(loop: Loop, host: Host) {
  host.fetchFromGitHub(loop.repo, loop.baseBranch);
  await checkRepo(loop, {
    isOnBase: onRef(host.git, remoteBase(loop)),
    labels: async () => lines(gh("label", "list", "-R", loop.repo, "--limit", "1000", "--json", "name", "-q", ".[].name")),
    gitConfigValue: fromGitConfig(host.git),
  });
}
