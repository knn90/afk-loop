import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SandboxExec } from "./afk-loop.js";
import { platformsChanged, platformsPresent, presentInSandbox, verifiedLine, type Platform } from "./platforms.js";

describe("platformsChanged", () => {
  test("a path under a platform's folder routes to that platform", async () => {
    const sut = makeSUT();

    const platforms = await sut.platformsChanged(["web/src/app.ts", "README.md"]);

    assert.deepEqual(platforms, [web]);
  });

  test("paths under several folders route to each, in the config's order", async () => {
    const sut = makeSUT(["server/go.mod"]);

    const platforms = await sut.platformsChanged(["server/main.go", "web/src/app.ts"]);

    assert.deepEqual(platforms, [web, server]);
  });

  test("paths under no platform's folder route to none", async () => {
    const sut = makeSUT();

    const platforms = await sut.platformsChanged(["docs/standards-web.md", ".sandcastle/loop.config.ts", "website.txt", "webby/a.ts"]);

    assert.deepEqual(platforms, []);
  });

  test("a platform with presentWhen routes only once that file is on the branch", async () => {
    const without = makeSUT();
    const withFile = makeSUT(["server/go.mod"]);

    assert.deepEqual(await without.platformsChanged(["server/main.go"]), []);
    assert.deepEqual(await withFile.platformsChanged(["server/main.go"]), [server]);
  });
});

describe("platformsPresent", () => {
  test("are every platform without presentWhen, and those whose file is on the branch", async () => {
    const without = makeSUT();
    const withFile = makeSUT(["server/go.mod"]);

    assert.deepEqual(await without.platformsPresent(), [web]);
    assert.deepEqual(await withFile.platformsPresent(), [web, server]);
  });
});

describe("presentInSandbox", () => {
  test("a file is present when it exists in the Sandbox's repo", async () => {
    const commands: string[] = [];
    const sandbox: SandboxExec = async (command) => {
      commands.push(command);
      return { exitCode: command.includes("server/go.mod") ? 0 : 1, output: "" };
    };

    const present = await platformsPresent([web, server, platform("cli", "cli/Cargo.toml")], presentInSandbox(sandbox));

    assert.deepEqual(present, [web, server]);
    assert.deepEqual(commands, ["test -e 'server/go.mod'", "test -e 'cli/Cargo.toml'"]);
  });
});

describe("verifiedLine", () => {
  test("names what each tested platform's Test run covered", () => {
    const sut = makeSUT();

    const line = sut.verifiedLine([web, server]);

    assert.equal(line, "Verified: the Test run passed on the reviewed commit (the web tests; the server tests).");
  });

  test("says there was no Test run when no platform is touched", () => {
    const sut = makeSUT();

    const line = sut.verifiedLine([]);

    assert.equal(line, "No Test run: the branch changes neither `web/` nor `server/`.");
  });

  test("names the one folder, or lists three or more, of the project's platforms", () => {
    assert.equal(verifiedLine([web], []), "No Test run: the branch doesn't change `web/`.");
    assert.equal(verifiedLine([web, server, platform("cli")], []), "No Test run: the branch changes none of `web/`, `server/` or `cli/`.");
  });
});

// MARK: - Helpers

function platform(name: string, presentWhen?: string): Platform {
  return {
    name,
    folder: name,
    standards: `docs/standards-${name}.md`,
    agentBuildHint: `run \`make ${name}\``,
    verified: `the ${name} tests`,
    ...(presentWhen ? { presentWhen } : {}),
    steps: async () => [],
  };
}

const web = platform("web");
const server = platform("server", "server/go.mod");

function makeSUT(filesOnBranch: string[] = []) {
  const platforms = [web, server];
  const isOnBranch = async (path: string) => filesOnBranch.includes(path);
  return {
    platformsChanged: (paths: string[]) => platformsChanged(platforms, paths, isOnBranch),
    platformsPresent: () => platformsPresent(platforms, isOnBranch),
    verifiedLine: (tested: Platform[]) => verifiedLine(platforms, tested),
  };
}
