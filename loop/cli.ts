import { pathToFileURL } from "node:url";
import { buildImage } from "./build-image.js";
import { findHost, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { run } from "./run.js";
import { smoke } from "./smoke.js";

export type Command = (loop: Loop, host: Host, args: readonly string[]) => Promise<void>;
type CommandName = "run" | "smoke" | "build-image";

const usage = "usage: afk-loop run [--cap <n>] | smoke | build-image";
const loopCommands: Record<CommandName, Command> = { run, smoke, "build-image": buildImage };

function isCommandName(name: string | undefined, commands: Record<CommandName, Command>): name is CommandName {
  return name !== undefined && Object.hasOwn(commands, name);
}

async function loadLoop({ configPath }: Host): Promise<Loop> {
  const { default: loop } = await import(pathToFileURL(configPath).href);
  if (typeof loop?.name !== "string" || typeof loop?.vms !== "object") throw new Error(`${configPath} must default-export defineLoop({ ... })`);
  return loop;
}

export async function afkLoop(args: readonly string[], { cwd = process.cwd(), commands = loopCommands } = {}) {
  const [name, ...rest] = args;
  if (!isCommandName(name, commands) || (name !== "run" && rest.length > 0)) throw new Error(usage);
  const host = findHost(cwd);
  await commands[name](await loadLoop(host), host, rest);
}
