import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const folder = fileURLToPath(new URL("..", import.meta.url));

describe("the loop's folder", () => {
  test("names no project: grep -ri for the project it was lifted from finds nothing", () => {
    const liftedFrom = new RegExp(["daily", "quest"].join(""), "i");
    const found = folderFiles().filter((file) => liftedFrom.test(readFileSync(join(folder, file), "utf8")));

    assert.deepEqual(found, []);
  });

  test("names no platform, build tool or simulator in its code: those are the project's", () => {
    const found = folderSources().filter(({ text }) => /\bios\b|android|xcodebuild|gradlew|simulator/i.test(text));

    assert.deepEqual(found.map(({ file }) => file), []);
  });

  test("names `main` only as the base branch default", () => {
    const found = folderSources().filter(({ text }) => /\bmain\b/.test(text.replace(`baseBranch: config.baseBranch ?? "main"`, "")));

    assert.deepEqual(found.map(({ file }) => file), []);
  });

  test("imports nothing outside itself but Node and its own dependencies", () => {
    const { dependencies } = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
    const allowed = new Set(Object.keys(dependencies));
    const outside = folderFiles()
      .filter((file) => /\.(ts|js)$/.test(file))
      .flatMap((file) => importsOf(readFileSync(join(folder, file), "utf8")).map((specifier) => ({ file, specifier })))
      .filter(({ file, specifier }) =>
        specifier.startsWith(".") ? relative(folder, resolve(folder, dirname(file), specifier)).startsWith("..") : !specifier.startsWith("node:") && !allowed.has(packageName(specifier)),
      );

    assert.deepEqual(outside, []);
  });

  test("its README shows the afk-loop commands, not the scripts they replaced", () => {
    const readme = readFileSync(join(folder, "README.md"), "utf8");

    for (const command of ["afk-loop run", "afk-loop smoke", "afk-loop build-image"]) assert.ok(readme.includes(command), command);
    assert.doesNotMatch(readme, /afk\.ts|smoke\.ts|setup-image\.ts|run build-image/);
  });

  test("copied alone next to another repo's config, typechecks", () => {
    const sandcastle = join(mkdtempSync(join(tmpdir(), "afk-loop-copy-")), ".sandcastle");
    cpSync(folder, join(sandcastle, "afk-loop"), { recursive: true, filter: (path) => !/node_modules|\.git$/.test(path) });
    mkdirSync(join(sandcastle, "node_modules"));
    const installed = join(folder, "node_modules");
    for (const dependency of ["@ai-hero", "@types", "tsx", "typescript", "undici-types"]) symlinkSync(join(installed, dependency), join(sandcastle, "node_modules", dependency));
    symlinkSync("../afk-loop", join(sandcastle, "node_modules", "afk-loop"));
    writeFileSync(join(sandcastle, "loop.config.ts"), otherProjectConfig);
    writeFileSync(join(sandcastle, "tsconfig.json"), readFileSync(join(folder, "tsconfig.json"), "utf8").replace(/"include": \[[^\]]*\]/, '"include": ["loop.config.ts", "afk-loop/*.ts", "afk-loop/loop/*.ts"]'));

    const typecheck = spawnSync(process.execPath, [join(installed, "typescript", "bin", "tsc"), "--noEmit", "-p", sandcastle], { encoding: "utf8" });

    assert.equal(typecheck.stdout, "");
    assert.equal(typecheck.status, 0);
  });
});

// MARK: - Helpers

function folderFiles(dir = ""): string[] {
  return readdirSync(join(folder, dir), { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .flatMap((entry) => (entry.isDirectory() ? folderFiles(join(dir, entry.name)) : [join(dir, entry.name)]));
}

function folderSources(): { file: string; text: string }[] {
  return folderFiles()
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => ({ file, text: readFileSync(join(folder, file), "utf8") }));
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:^import [^;]*?from |^export [^;]*? from |\bimport\()"([^"]+)"/gm)].map((match) => match[1] ?? "");
}

function packageName(specifier: string): string {
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

const otherProjectConfig = `import { defineLoop, type Platform } from "afk-loop";

const web: Platform = {
  name: "web",
  folder: "web",
  standards: "docs/web-standards.md",
  agentBuildHint: "run \\\`npm test\\\` from \\\`web/\\\`",
  verified: "the web tests",
  async steps() {
    return [{ name: "web", cwd: "web", command: "npm test 2>&1", format: { line: /FAIL/, blockHeader: /^Failures:/, blockLine: /^ / } }];
  },
};

export default defineLoop({
  repo: "acme/Habitat",
  image: { source: "ghcr.io/acme/macos:1", cpus: 4, memoryMb: 4096, provision: [] },
  smokeIssue: 3,
  platforms: [web],
});
`;
