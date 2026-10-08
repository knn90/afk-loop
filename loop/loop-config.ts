import type { Platform } from "./platforms.js";

export interface Image {
  readonly source: string;
  readonly cpus: number;
  readonly memoryMb: number;
  readonly provision: readonly string[];
  readonly tools?: string;
}

export interface LoopConfig {
  readonly name?: string;
  readonly repo: string;
  readonly image: Image;
  readonly smokeIssue: number;
  readonly platforms: readonly Platform[];
  readonly model?: string;
  readonly baseBranch?: string;
}

export interface Project {
  readonly repo: string;
  readonly image: Pick<Image, "tools">;
  readonly platforms: readonly Platform[];
}

export interface Loop extends Required<LoopConfig> {
  readonly vms: { readonly base: string; readonly issue: (issueNumber: number) => string; readonly smoke: string };
}

function issueVmPrefix(name: string): string {
  return `${name}-issue-`;
}

export function defineLoop(config: LoopConfig): Loop {
  const name = config.name ?? (config.repo.split("/").at(-1) ?? config.repo).toLowerCase();
  return {
    ...config,
    name,
    model: config.model ?? "claude-opus-5-5",
    baseBranch: config.baseBranch ?? "main",
    vms: { base: `${name}-base`, issue: (issueNumber) => `${issueVmPrefix(name)}${issueNumber}`, smoke: `${name}-smoke` },
  };
}

export function leftoverVms(loop: Loop, vmNames: readonly string[]): string[] {
  const prefix = issueVmPrefix(loop.name);
  return vmNames.filter((vm) => vm.startsWith(prefix) && /^\d+$/.test(vm.slice(prefix.length)));
}
