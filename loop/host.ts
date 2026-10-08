import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { leftoverVms, type Loop } from "./loop-config.js";
import { deleteVm, tartBin, vmNames } from "./tart.js";

const configFolder = ".sandcastle";
const configFile = "loop.config.ts";

export interface Host {
  readonly repoRoot: string;
  readonly configDir: string;
  readonly configPath: string;
  git(...args: string[]): string;
  gitWithGitHub(...args: string[]): string;
  fetchFromGitHub(repo: string, ...branches: string[]): void;
}

export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function succeeds(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function findHost(cwd: string = process.cwd()): Host {
  let repoRoot: string;
  try {
    repoRoot = gitAt(cwd, "rev-parse", "--show-toplevel").trim();
  } catch {
    throw new Error(`${cwd} is not in a git repo: afk-loop runs inside a repo that has ${configFolder}/${configFile}`);
  }
  const host = hostAt(repoRoot);
  check(existsSync(host.configPath), `no ${host.configPath}: afk-loop runs inside a repo that has one`);
  return host;
}

export function loadHostEnv({ configDir }: Host) {
  check(existsSync(`${configDir}.env`), `missing ${configFolder}/.env (copy .env.example)`);
  check(existsSync(`${configDir}host.env`), `missing ${configFolder}/host.env (copy host.env.example)`);

  const sandboxEnv = parseEnv(readFileSync(`${configDir}.env`, "utf8"));
  check(!!sandboxEnv.CLAUDE_CODE_OAUTH_TOKEN, `CLAUDE_CODE_OAUTH_TOKEN empty in ${configFolder}/.env`);
  check(!("GH_TOKEN" in sandboxEnv) && !("GITHUB_TOKEN" in sandboxEnv), `GitHub token in ${configFolder}/.env reaches the Sandbox`);

  process.loadEnvFile(`${configDir}host.env`);
  check(!!process.env.GH_TOKEN, `GH_TOKEN empty in ${configFolder}/host.env`);
}

export function checkTart(loop: Loop) {
  check(succeeds(tartBin, ["--version"]), "Tart isn't installed (see afk-loop's README.md)");
  check(vmNames().includes(loop.vms.base), `base VM ${loop.vms.base} missing (npx --prefix ${configFolder} afk-loop build-image)`);
}

export function deleteLeftoverVms(loop: Loop) {
  for (const vm of leftoverVms(loop, vmNames())) deleteVm(vm);
}

export function logsDir({ configDir }: Host): string {
  return `${configDir}logs/`;
}

export function repoUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

export function branchFileName(branch: string): string {
  return branch.replaceAll("/", "-");
}

export function lines(output: string): string[] {
  return output.split("\n").filter(Boolean);
}

export function gh(...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}

export function ghWithInput(input: string, ...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", input });
}

function gitAt(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8" });
}

export function hostAt(repoRoot: string): Host {
  const git = (...args: string[]) => gitAt(repoRoot, ...args);
  const gitWithGitHub = (...args: string[]) => git("-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", ...args);
  const configDir = `${join(repoRoot, configFolder)}/`;
  return {
    repoRoot,
    configDir,
    configPath: `${configDir}${configFile}`,
    git,
    gitWithGitHub,
    fetchFromGitHub(repo, ...branches) {
      gitWithGitHub("fetch", repoUrl(repo), ...branches.map((branch) => `+refs/heads/${branch}:refs/remotes/origin/${branch}`));
    },
  };
}
