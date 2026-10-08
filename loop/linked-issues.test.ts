import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { linkedIssueBlock, linkedIssueCharLimit, linkedIssueLimit, linkedIssueNumbers } from "./linked-issues.js";

describe("linkedIssueNumbers", () => {
  test("finds issues named by number and by URL", () => {
    const body = "Start from [the ticket](https://github.com/acme/Habitat/issues/224), see also #212.";

    const numbers = linkedIssueNumbers({ number: 230, body });

    assert.deepEqual(numbers, [224, 212]);
  });

  test("skips the Parent and Blocked by sections", () => {
    const body = "## Parent\n\n#226\n\n## What to build\n\nAs in #224.\n\n## Blocked by\n\n- #229";

    const numbers = linkedIssueNumbers({ number: 230, body });

    assert.deepEqual(numbers, [224]);
  });

  test("skips the issue itself and repeats", () => {
    const body = "#230 follows #224, and #224 again.";

    const numbers = linkedIssueNumbers({ number: 230, body });

    assert.deepEqual(numbers, [224]);
  });

  test("skips a number that is not an issue reference", () => {
    const body = "Colour `abc#123`, heading anchor docs/x.md/#45.";

    const numbers = linkedIssueNumbers({ number: 230, body });

    assert.deepEqual(numbers, []);
  });

  test("stops at the limit", () => {
    const body = "#1 #2 #3 #4 #5 #6 #7";

    const numbers = linkedIssueNumbers({ number: 230, body });

    assert.equal(numbers.length, linkedIssueLimit);
  });
});

describe("linkedIssueBlock", () => {
  test("holds the title, body and comments", () => {
    const linked = { number: 224, title: "Verify the stack", body: "Body", comments: ["## Resolution\n\nCatalog"] };

    const block = linkedIssueBlock(linked);

    assert.equal(block, '<linked-issue number="224">\n# Verify the stack\n\nBody\n\n## Resolution\n\nCatalog\n</linked-issue>');
  });

  test("truncates past the character limit", () => {
    const linked = { number: 224, title: "Long", body: "x".repeat(linkedIssueCharLimit), comments: [] };

    const block = linkedIssueBlock(linked);

    assert.match(block, /x\n… truncated\n<\/linked-issue>$/);
    assert.ok(block.length < linkedIssueCharLimit + 100);
  });
});
