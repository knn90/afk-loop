import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { shortSha } from "./behavior-check.js";
import type { Host } from "./host.js";

type ConfigDir = Pick<Host, "configDir">;

const keptForMs = 30 * 24 * 60 * 60 * 1000;

const evidenceRoot = ({ configDir }: ConfigDir) => `${configDir}evidence/`;

export function hostEvidenceFolder(host: ConfigDir, issueNumber: number, head: string): string {
  const root = evidenceRoot(host);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
    writeFileSync(`${root}.gitignore`, "*\n");
  }
  const folder = `${root}${issueNumber}-${shortSha(head)}/`;
  mkdirSync(folder, { recursive: true });
  return folder;
}

export function deleteOldEvidence(host: ConfigDir, now: Date = new Date()) {
  const root = evidenceRoot(host);
  if (!existsSync(root)) return;
  const folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const folder of folders) {
    const path = `${root}${folder.name}`;
    if (now.getTime() - statSync(path).mtimeMs > keptForMs) rmSync(path, { recursive: true, force: true });
  }
}
