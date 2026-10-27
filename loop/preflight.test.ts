import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { Platform } from "./platforms.js";
import { checkRepo, fromGitConfig, onRef } from "./preflight.js";

describe("checkRepo", () => {
  test("lists two missing things in one message, each with its fix", async () => {
    const sut = makeSUT({ missingFiles: ["GLOSSARY.md"], missingLabels: ["ready-for-human"] });

    await assert.rejects(sut.check(), (error: Error) => {
      assert.equal(
        error.message,
        [
          "acme/shop lacks what the loop requires; nothing started:",
          "- GLOSSARY.md missing on origin/trunk: add it and push it to trunk",
          "- label ready-for-human missing: gh label create ready-for-human -R acme/shop",
          "What a repo needs: afk-loop's README.md#what-a-repo-needs",
        ].join("\n"),
      );
      return true;
    });
  });

  test("passes with everything present", async () => {
    const sut = makeSUT();

    await sut.check();
  });

  test("matches labels as GitHub does, ignoring case", async () => {
    const sut = makeSUT({ labels: ["Ready-For-Agent", "READY-FOR-HUMAN"] });

    await sut.check();
  });

  test("requires each platform's standards file and the git conventions", async () => {
    const sut = makeSUT({ missingFiles: ["docs/standards-server.md", "docs/agents/git-conventions.md"], missingLabels: ["ready-for-agent", "ready-for-human"] });

    await assert.rejects(sut.check(), (error: Error) => {
      assert.deepEqual(error.message.split("\n").slice(1, -1), [
        "- docs/agents/git-conventions.md missing on origin/trunk: add it and push it to trunk",
        "- docs/standards-server.md missing on origin/trunk: add it and push it to trunk",
        "- label ready-for-agent missing: gh label create ready-for-agent -R acme/shop",
        "- label ready-for-human missing: gh label create ready-for-human -R acme/shop",
      ]);
      return true;
    });
  });

  test("requires the SKILL.md of each platform's Verify skill", async () => {
    const sut = makeSUT({ platforms: [platform("web", { verifySkill: "verify-web" }), platform("server")], missingFiles: [".claude/skills/verify-web/SKILL.md"] });

    await assert.rejects(sut.check(), (error: Error) => {
      assert.deepEqual(error.message.split("\n").slice(1, -1), ["- .claude/skills/verify-web/SKILL.md missing on origin/trunk: add it and push it to trunk"]);
      return true;
    });
  });

  test("requires the Host's git user.name and user.email", async () => {
    const sut = makeSUT({ gitConfig: {}, missingLabels: ["ready-for-human"] });

    await assert.rejects(sut.check(), (error: Error) => {
      assert.deepEqual(error.message.split("\n").slice(1, -1), [
        "- label ready-for-human missing: gh label create ready-for-human -R acme/shop",
        '- git user.name not set: git config user.name "<your name>"',
        '- git user.email not set: git config user.email "<your email>"',
      ]);
      return true;
    });
  });

  test("a platform without a Verify skill requires no SKILL.md", async () => {
    const sut = makeSUT({ missingFiles: [".claude/skills/verify-web/SKILL.md"] });

    await sut.check();
  });
});

describe("onRef", () => {
  test("a file present in the working tree and absent on the base branch counts as missing", async () => {
    const git = gitRepo();
    writeFileSync(join(git.dir, "GLOSSARY.md"), "# Shop\n");
    git("add", "GLOSSARY.md");
    git("commit", "--quiet", "-m", "Add the glossary");
    git("update-ref", "refs/remotes/origin/trunk", "HEAD");
    mkdirSync(join(git.dir, "docs"));
    writeFileSync(join(git.dir, "docs/standards-web.md"), "# Web\n");
    git("add", "docs/standards-web.md");
    git("commit", "--quiet", "-m", "Add the web standards, not pushed");

    const isOnBase = onRef(git, "refs/remotes/origin/trunk");

    assert.equal(await isOnBase("GLOSSARY.md"), true);
    assert.equal(await isOnBase("docs/standards-web.md"), false);
  });
});

describe("fromGitConfig", () => {
  test("gives a set key's value, and an empty string for an unset key", async () => {
    const git = gitRepo();
    git("config", "afk.owner", "Ada");

    assert.equal(await fromGitConfig(git)("afk.owner"), "Ada");
    assert.equal(await fromGitConfig(git)("afk.unset"), "");
  });

  test("falls back to the global config", async () => {
    const git = gitRepo();
    git("config", "--global", "afk.owner", "Ada");

    assert.equal(await fromGitConfig(git)("afk.owner"), "Ada");
  });

  test("throws when git fails for another reason than an unset key", async () => {
    const brokenGit = () => {
      throw Object.assign(new Error("not a git repository"), { status: 128 });
    };

    await assert.rejects(fromGitConfig(brokenGit)("user.name"), /not a git repository/);
  });
});

// MARK: - Helpers

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "global.gitconfig") };
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: dir, encoding: "utf8", env });
  git("init", "--quiet");
  return Object.assign(git, { dir });
}

function platform(name: string, overrides: Partial<Platform> = {}): Platform {
  return {
    name,
    folder: name,
    standards: `docs/standards-${name}.md`,
    agentBuildHint: `run \`make ${name}\``,
    verified: `the ${name} tests`,
    steps: async () => [],
    ...overrides,
  };
}

interface SUTOptions {
  platforms?: Platform[];
  missingFiles?: string[];
  missingLabels?: string[];
  labels?: string[];
  gitConfig?: Record<string, string>;
}

function makeSUT({
  platforms = [platform("web"), platform("server")],
  missingFiles = [],
  missingLabels = [],
  labels = ["bug", "ready-for-agent", "ready-for-human"],
  gitConfig = { "user.name": "Ada", "user.email": "ada@example.com" },
}: SUTOptions = {}) {
  const project = { repo: "acme/shop", baseBranch: "trunk", platforms };
  const repo = {
    isOnBase: async (path: string) => !missingFiles.includes(path),
    labels: async () => labels.filter((label) => !missingLabels.includes(label)),
    gitConfigValue: async (key: string) => gitConfig[key] ?? "",
  };
  return { check: () => checkRepo(project, repo) };
}
