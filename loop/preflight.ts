import { gh, lines, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { readyForAgent, readyForHuman } from "./loop-rules.js";
import type { Platform } from "./platforms.js";
import { remoteBase } from "./sandcastle-agents.js";

export interface RepoRequirements {
  readonly repo: string;
  readonly baseBranch: string;
  readonly platforms: readonly Platform[];
}

export interface RepoProbe {
  isOnBase(path: string): Promise<boolean>;
  labels(): Promise<string[]>;
}

const requiredFiles = ["GLOSSARY.md", "docs/agents/git-conventions.md"];
const requiredLabels = [readyForAgent, readyForHuman];

export async function checkRepo({ repo, baseBranch, platforms }: RepoRequirements, probe: RepoProbe) {
  const files = [...requiredFiles, ...platforms.map((platform) => platform.standards)];
  const missingFiles = (await Promise.all(files.map(async (path) => ((await probe.isOnBase(path)) ? [] : [path])))).flat();
  const labels = (await probe.labels()).map((label) => label.toLowerCase());
  const missing = [
    ...missingFiles.map((path) => `${path} missing on origin/${baseBranch}: add it and push it to ${baseBranch}`),
    ...requiredLabels.filter((label) => !labels.includes(label)).map((label) => `label ${label} missing: gh label create ${label} -R ${repo}`),
  ];
  if (missing.length === 0) return;
  throw new Error([`${repo} lacks what the loop requires; nothing started:`, ...missing.map((thing) => `- ${thing}`), "What a repo needs: afk-loop's README.md#what-a-repo-needs"].join("\n"));
}

export function onRef(git: (...args: string[]) => string, ref: string): RepoProbe["isOnBase"] {
  return async (path) => lines(git("ls-tree", "--name-only", ref, "--", path)).includes(path);
}

export async function checkRepoOnGitHub(loop: Loop, host: Host) {
  host.fetchFromGitHub(loop.repo, loop.baseBranch);
  await checkRepo(loop, {
    isOnBase: onRef(host.git, remoteBase(loop)),
    labels: async () => lines(gh("label", "list", "-R", loop.repo, "--limit", "1000", "--json", "name", "-q", ".[].name")),
  });
}
