import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { boot, copyIn, deleteVm, guestExec, guestRepo, quote, repoExec, shutDown, tart } from "./tart.js";
import { platformsPresent, presentInSandbox } from "./platforms.js";
import { checkSkillsPlugin, installSkillsPlugin } from "./skills-plugin.js";
import { routedTestRun } from "./test-run.js";

const guestBundle = "/tmp/repo.bundle";
const minClaudeCodePatch = 280;

export async function buildImage(loop: Loop, host: Host) {
  const { image } = loop;
  const baseVm = loop.vms.base;
  const provision = [
    "brew update --quiet && brew upgrade --cask claude-code",
    `claude --version | awk -F. '{ print; if ($1 < 2 || ($1 == 2 && $2 == 1 && $3 < ${minClaudeCodePatch})) exit 1 }'`,
    ...installSkillsPlugin,
    ...image.provision,
    "! gh auth status",
  ];

  const guest = async (script: string, onLine: (line: string) => void = console.log) => {
    console.log(`$ ${script}`);
    const result = await guestExec(baseVm, script, { onLine });
    check(result.exitCode === 0, `${script} failed in ${baseVm}: ${result.stderr}`);
    return result.stdout;
  };

  const copyRepoIn = async () => {
    const bundleDir = mkdtempSync(join(tmpdir(), `${loop.name}-bundle-`));
    try {
      host.git("bundle", "create", "--quiet", `${bundleDir}/repo.bundle`, "HEAD");
      await copyIn(baseVm, `${bundleDir}/repo.bundle`, guestBundle);
    } finally {
      rmSync(bundleDir, { recursive: true });
    }
    await guest(`rm -rf ${quote(guestRepo)} && git clone --quiet ${guestBundle} ${quote(guestRepo)} && rm ${guestBundle}`);
  };

  deleteVm(baseVm);
  console.log(`Cloning ${image.source}`);
  tart("clone", image.source, baseVm);
  try {
    tart("set", baseVm, "--cpu", String(image.cpus), "--memory", String(image.memoryMb));
    await boot(baseVm);
    for (const step of provision) await guest(step);
    console.log(await checkSkillsPlugin((script) => guest(script, () => {})));

    await copyRepoIn();
    const repo = repoExec(baseVm);
    const platforms = await platformsPresent(loop.platforms, presentInSandbox(repo));
    for (const { name, presentWhen } of loop.platforms.filter((platform) => !platforms.includes(platform))) {
      console.log(`No ${presentWhen} on the branch: ${name} pre-warm skipped`);
    }
    const warmUp = await routedTestRun(host).run(repo, "base-image", platforms);
    check(warmUp.passed, `pre-warm Test run failed:\n${warmUp.log}`);
    await guest(`rm -rf ${quote(guestRepo)}`);

    await shutDown(baseVm);
  } catch (error) {
    deleteVm(baseVm);
    throw error;
  }
  console.log(`Base VM ${baseVm} ready`);
}
