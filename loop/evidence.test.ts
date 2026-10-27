import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { deleteOldEvidence, hostEvidenceFolder } from "./evidence.js";

describe("hostEvidenceFolder", () => {
  test("is .sandcastle/evidence/<issue>-<short sha>/ on the Host", () => {
    const configDir = newConfigDir();

    const folder = hostEvidenceFolder({ configDir }, 47, "0123456789abcdef0123456789abcdef01234567");

    assert.equal(folder, `${configDir}evidence/47-0123456/`);
    assert.ok(existsSync(folder));
  });

  test("the first time it makes the evidence folder, it writes a .gitignore there that ignores everything, so git never sees the Behavior evidence", () => {
    const configDir = newConfigDir();
    const repo = join(configDir, "..");
    spawnSync("git", ["init", "--quiet", repo]);

    const folder = hostEvidenceFolder({ configDir }, 47, "abcdef1234");
    writeFileSync(join(folder, "streak.png"), "png");

    assert.equal(readFileSync(`${configDir}evidence/.gitignore`, "utf8"), "*\n");
    assert.equal(spawnSync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).stdout, "");
  });

  test("leaves a .gitignore the maintainer changed alone on later folders", () => {
    const configDir = newConfigDir();
    hostEvidenceFolder({ configDir }, 47, "abcdef1234");
    writeFileSync(`${configDir}evidence/.gitignore`, "*\n!keep\n");

    hostEvidenceFolder({ configDir }, 48, "1234abcdef");

    assert.equal(readFileSync(`${configDir}evidence/.gitignore`, "utf8"), "*\n!keep\n");
  });
});

describe("deleteOldEvidence", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const folderFrom = (configDir: string, issueNumber: number, at: Date) => {
    const folder = hostEvidenceFolder({ configDir }, issueNumber, "abcdef1234");
    writeFileSync(join(folder, "streak.png"), "png");
    utimesSync(folder, at, at);
    return folder;
  };

  test("deletes evidence folders older than 30 days and keeps newer ones and the .gitignore", () => {
    const configDir = newConfigDir();
    folderFrom(configDir, 1, daysAgo(31));
    folderFrom(configDir, 2, daysAgo(29));

    deleteOldEvidence({ configDir }, now);

    assert.deepEqual(readdirSync(`${configDir}evidence`).sort(), [".gitignore", "2-abcdef1"]);
  });

  test("does nothing when the Host has no evidence folder yet", () => {
    const configDir = newConfigDir();

    deleteOldEvidence({ configDir }, now);

    assert.ok(!existsSync(`${configDir}evidence`));
  });
});

function newConfigDir(): string {
  return `${join(mkdtempSync(join(tmpdir(), "evidence-")), ".sandcastle")}/`;
}
