import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createIsolatedSandboxProvider, type ExecResult, type IsolatedSandboxHandle } from "@ai-hero/sandcastle";
import type { SandboxExec } from "./afk-loop.js";

const localTart = `${homedir()}/.local/bin/tart`;
export const tartBin = existsSync(localTart) ? localTart : "tart";
export const guestRepo = "/Users/admin/workspace";
export const timedOutExitCode = 124;
const bootTimeoutMs = 5 * 60 * 1000;
const shutdownTimeoutMs = 2 * 60 * 1000;

interface VirtualMachine {
  readonly Name: string;
  readonly Source: string;
  readonly Running: boolean;
}

export interface GuestOptions {
  readonly stdin?: string;
  readonly onLine?: (line: string) => void;
  readonly timeoutMs?: number;
}

export function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function tart(...args: string[]): string {
  return execFileSync(tartBin, args, { encoding: "utf8", env: { ...process.env, TART_NO_AUTO_PRUNE: "1" } });
}

function localVms(): VirtualMachine[] {
  const vms: VirtualMachine[] = JSON.parse(tart("list", "--source", "local", "--format", "json"));
  return vms.filter((vm) => vm.Source === "local");
}

export function vmNames(): string[] {
  return localVms().map((vm) => vm.Name);
}

export function deleteVm(vm: string) {
  const found = localVms().find((candidate) => candidate.Name === vm);
  if (!found) return;
  if (found.Running) tart("stop", vm, "--timeout", "5");
  tart("delete", vm);
}

function guestReady(vm: string): Promise<boolean> {
  return new Promise((resolve) => execFile(tartBin, ["exec", vm, "true"], { timeout: 5000 }, (error) => resolve(!error)));
}

async function waitUntil(done: () => boolean | Promise<boolean>, timeoutMs: number, what: string) {
  const start = Date.now();
  while (!(await done())) {
    if (Date.now() - start > timeoutMs) throw new Error(`${what} after ${timeoutMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function boot(vm: string) {
  spawn(tartBin, ["run", vm, "--no-graphics", "--no-audio", "--no-clipboard"], { detached: true, stdio: "ignore" }).unref();
  await waitUntil(() => guestReady(vm), bootTimeoutMs, `VM ${vm} not ready`);
}

export async function shutDown(vm: string) {
  await guestExec(vm, "sync; sudo -n shutdown -h now");
  await waitUntil(() => !localVms().find((candidate) => candidate.Name === vm)?.Running, shutdownTimeoutMs, `VM ${vm} still running`);
}

function guestProcess(vm: string, script: string, stdin: "pipe" | "ignore", timeoutMs?: number): ChildProcess {
  return spawn(tartBin, ["exec", ...(stdin === "pipe" ? ["-i"] : []), vm, "/bin/zsh", "-lc", script], {
    stdio: [stdin, "pipe", "pipe"],
    timeout: timeoutMs,
  });
}

export function guestExec(vm: string, script: string, options: GuestOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = guestProcess(vm, script, options.stdin === undefined ? "ignore" : "pipe", options.timeoutMs);
    const stdout: string[] = [];
    let stderr = "";
    createInterface({ input: child.stdout! }).on("line", (line) => {
      stdout.push(line);
      options.onLine?.(line);
    });
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const timedOut = signal ? `\nerror: stopped by ${signal} (timeout ${(options.timeoutMs ?? 0) / 60000} min)` : "";
      resolve({ stdout: stdout.join("\n"), stderr: stderr + timedOut, exitCode: signal ? timedOutExitCode : (code ?? 1) });
    });
    if (options.stdin !== undefined) child.stdin!.end(options.stdin);
  });
}

export function repoExec(vm: string): SandboxExec {
  return async (command, options) => {
    const result = await guestExec(vm, `cd ${quote(`${guestRepo}/${options?.cwd ?? ""}`)} && ${command}`, { timeoutMs: options?.timeoutMs });
    return { exitCode: result.exitCode, output: result.stdout + result.stderr };
  };
}

function finished(child: ChildProcess, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${what} exited ${code}`))));
  });
}

export async function copyIn(vm: string, hostPath: string, guestPath: string) {
  const what = `copy of ${basename(hostPath)} into ${vm}`;
  if (statSync(hostPath).isDirectory()) {
    const unpack = guestProcess(vm, `mkdir -p ${quote(guestPath)} && tar -xf - -C ${quote(guestPath)}`, "pipe");
    const pack = spawn("tar", ["-cf", "-", "-C", hostPath, "."], { stdio: ["ignore", "pipe", "inherit"] });
    await Promise.all([pipeline(pack.stdout!, unpack.stdin!), finished(unpack, what)]);
  } else {
    const write = guestProcess(vm, `mkdir -p ${quote(dirname(guestPath))} && cat > ${quote(guestPath)}`, "pipe");
    await Promise.all([pipeline(createReadStream(hostPath), write.stdin!), finished(write, what)]);
  }
}

export async function copyFileOut(vm: string, guestPath: string, hostPath: string) {
  await mkdir(dirname(hostPath), { recursive: true });
  const read = guestProcess(vm, `cat ${quote(guestPath)}`, "ignore");
  await Promise.all([pipeline(read.stdout!, createWriteStream(hostPath)), finished(read, `copy of ${basename(guestPath)} out of ${vm}`)]);
}

export const tartSandbox = (options: { readonly baseVm: string; readonly vm: string }) =>
  createIsolatedSandboxProvider({
    name: "tart",
    create: async ({ env }): Promise<IsolatedSandboxHandle> => {
      const { vm } = options;
      deleteVm(vm);
      tart("clone", options.baseVm, vm);
      await boot(vm);

      const exports = Object.entries(env)
        .map(([key, value]) => `export ${key}=${quote(value)}; `)
        .join("");
      const exec: IsolatedSandboxHandle["exec"] = (command, opts) =>
        guestExec(vm, `${exports}cd ${quote(opts?.cwd ?? guestRepo)} && ${opts?.sudo ? "sudo " : ""}${command}`, opts);
      await exec(`mkdir -p ${quote(guestRepo)}`, { cwd: "/" });

      return {
        worktreePath: guestRepo,
        exec,
        copyIn: (hostPath, sandboxPath) => copyIn(vm, hostPath, sandboxPath),
        copyFileOut: (sandboxPath, hostPath) => copyFileOut(vm, sandboxPath, hostPath),
        close: async () => deleteVm(vm),
      };
    },
  });
