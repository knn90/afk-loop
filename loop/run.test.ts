import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { report, runOptions } from "./run.js";

describe("runOptions", () => {
  test("the cap is the only option", () => {
    assert.deepEqual(runOptions(["--cap", "2"]), { cap: 2 });
  });

  test("--auto-merge is refused as an unknown option", () => {
    assert.throws(() => runOptions(["--auto-merge"]), { code: "ERR_PARSE_ARGS_UNKNOWN_OPTION", message: /Unknown option '--auto-merge'/ });
  });
});

describe("report", () => {
  test("a Handoff's line says why", () => {
    assert.equal(
      report({ issue: 1, kind: "handoff", branch: "issue/1-issue-1", reason: "no-commits", lastReply: "", implementerLog: "logs/implementer-1" }),
      "handoff: the Implementer made no commits",
    );
    assert.equal(
      report({ issue: 1, kind: "handoff", branch: "issue/1-issue-1", reason: "attempt-budget", log: "error" }),
      "handoff: the Attempt budget (3) ran out without a green Test run",
    );
  });
});
