import { basename } from "node:path";
import { check } from "./host.js";
import { quote } from "./tart.js";

const source = "mattpocock/skills";
const version = "1.3.1";
const tag = `v${version}`;
const plugin = "mattpocock-skills";
const marketplace = "mattpocock";
const pluginId = `${plugin}@${marketplace}`;

export const requiredSkills = ["tdd", "code-review", "codebase-design", "pr"] as const;
export type RequiredSkill = (typeof requiredSkills)[number];

export function skill(name: RequiredSkill): string {
  return `${plugin}:${name}`;
}

// `--help` omits it, but a GitHub source takes `#<ref>` and clones at that tag (checked 2026-10-08).
export const installSkillsPlugin = [`claude plugin marketplace add ${quote(`${source}#${tag}`)}`, `claude plugin install ${pluginId}`];

export async function checkSkillsPlugin(guest: (script: string) => Promise<string>): Promise<string> {
  const plugins: { id: string; installPath: string }[] = JSON.parse(await guest("claude plugin list --json"));
  const installed = plugins.find((candidate) => candidate.id === pluginId);
  check(!!installed, `${pluginId} is not installed`);
  const manifest: { version: string; skills?: string[] } = JSON.parse(await guest(`cat ${quote(`${installed.installPath}/.claude-plugin/plugin.json`)}`));
  check(manifest.version === version, `skills plugin ${plugin} is ${manifest.version}, not the pinned ${version}`);
  const present = new Set((manifest.skills ?? []).map((path) => basename(path)));
  const missing = requiredSkills.filter((name) => !present.has(name));
  check(missing.length === 0, `skills plugin ${plugin} ${version} lacks the required skills ${missing.join(", ")}`);
  return `skills plugin ${plugin} ${version} (${source}#${tag}) has ${requiredSkills.join(", ")}`;
}
