import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hasWriteAccess, isLoopComment } from "./review-comments.js";

describe("hasWriteAccess", () => {
  test("an owner and a collaborator have it; anyone else doesn't", () => {
    const associations = ["OWNER", "COLLABORATOR", "CONTRIBUTOR", "MEMBER", "NONE"];

    const withAccess = associations.filter((authorAssociation) => hasWriteAccess({ authorAssociation }));

    assert.deepEqual(withAccess, ["OWNER", "COLLABORATOR"]);
  });
});

describe("isLoopComment", () => {
  test("a comment starting with the loop marker is the loop's", () => {
    const comment = { body: "<!-- afk-loop -->\nHanded off to a human." };

    assert.equal(isLoopComment(comment), true);
  });

  test("a maintainer's own comment isn't the loop's, even when it quotes the marker", () => {
    const comment = { body: "The loop wrote `<!-- afk-loop -->` above." };

    assert.equal(isLoopComment(comment), false);
  });
});
