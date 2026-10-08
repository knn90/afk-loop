import type { SandboxExec, TestRunner } from "./afk-loop.js";
import { quote } from "./tart.js";
import type { FailureFormat } from "./test-log.js";

export interface Step {
  readonly name: string;
  readonly cwd: string;
  readonly command: string;
  readonly format: FailureFormat;
}

export interface Platform {
  readonly name: string;
  readonly folder: string;
  readonly standards: string;
  readonly agentBuildHint: string;
  readonly verified: string;
  readonly presentWhen?: string;
  steps(sandbox: SandboxExec): Promise<Step[]>;
  afterFailure?(sandbox: SandboxExec, exitCode: number): Promise<void>;
}

export type IsOnBranch = (path: string) => Promise<boolean>;

export function folder(platform: Platform): string {
  return `${platform.folder}/`;
}

export function changesNoPlatform(platforms: readonly Platform[]): string {
  const folders = platforms.map((platform) => `\`${folder(platform)}\``);
  if (folders.length === 1) return `doesn't change ${folders[0]}`;
  if (folders.length === 2) return `changes neither ${folders[0]} nor ${folders[1]}`;
  return `changes none of ${folders.slice(0, -1).join(", ")} or ${folders.at(-1)}`;
}

export async function platformsPresent(platforms: readonly Platform[], isOnBranch: IsOnBranch): Promise<Platform[]> {
  const present = await Promise.all(platforms.map((platform) => (platform.presentWhen ? isOnBranch(platform.presentWhen) : true)));
  return platforms.filter((_, index) => present[index]);
}

export function presentInSandbox(sandbox: SandboxExec): IsOnBranch {
  return async (path) => (await sandbox(`test -e ${quote(path)}`)).exitCode === 0;
}

export async function platformsChanged(platforms: readonly Platform[], changedPaths: readonly string[], isOnBranch: IsOnBranch): Promise<Platform[]> {
  const changed = platforms.filter((platform) => changedPaths.some((path) => path.startsWith(folder(platform))));
  return platformsPresent(changed, isOnBranch);
}

export async function testChangedPlatforms(testRunner: TestRunner, sandbox: SandboxExec, branch: string, platforms: readonly Platform[]) {
  return platforms.length > 0 ? testRunner.run(sandbox, branch, platforms) : { passed: true, log: "" };
}

export function verifiedLine(platforms: readonly Platform[], tested: readonly Platform[]): string {
  if (tested.length === 0) return `No Test run: the branch ${changesNoPlatform(platforms)}.`;
  return `Verified: the Test run passed on the reviewed commit (${tested.map((platform) => platform.verified).join("; ")}).`;
}
