import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runOptions } from "./run.js";

describe("runOptions", () => {
  test("the cap is the only option", () => {
    assert.deepEqual(runOptions(["--cap", "2"]), { cap: 2 });
  });

  test("--auto-merge is refused as an unknown option", () => {
    assert.throws(() => runOptions(["--auto-merge"]), { code: "ERR_PARSE_ARGS_UNKNOWN_OPTION", message: /Unknown option '--auto-merge'/ });
  });
});
