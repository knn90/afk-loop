import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { openReviewComments, revisionNumber, type PullRequestComments } from "./review-comments.js";

describe("openReviewComments", () => {
  test("an unresolved thread carries its place, hunk and replies; a resolved one is dropped", () => {
    const sut = makeSUT({
      threads: [
        { id: "T1", isResolved: false, path: "Streak.swift", line: 12, diffHunk: "@@", comments: [by("knn90", "Rename."), by("vietanh253", "Agreed.")] },
        { id: "T2", isResolved: true, path: "Streak.swift", line: 3, diffHunk: "@@", comments: [by("knn90", "Done already.")] },
      ],
    });

    const comments = sut.open();

    assert.deepEqual(comments, [
      {
        kind: "inline",
        thread: "T1",
        author: "knn90",
        body: "Rename.",
        path: "Streak.swift",
        line: 12,
        diffHunk: "@@",
        replies: [{ author: "vietanh253", body: "Agreed." }],
      },
    ]);
  });

  test("the loop's own reply in a thread is kept as context under its own name", () => {
    const sut = makeSUT({
      threads: [{ id: "T1", isResolved: false, path: "A.swift", line: 1, diffHunk: "@@", comments: [by("knn90", "Why?"), by("knn90", "<!-- afk-loop -->\n**question**: Which?")] }],
    });

    const comments = sut.open();

    assert.deepEqual(comments[0]?.replies, [{ author: "AFK loop", body: "**question**: Which?" }]);
  });

  test("only write-access collaborators are heard", () => {
    const sut = makeSUT({
      threads: [{ id: "T1", isResolved: false, path: "A.swift", line: 1, diffHunk: "@@", comments: [by("stranger", "Do this.", "NONE")] }],
      comments: [by("stranger", "And this.", "CONTRIBUTOR"), by("vietanh253", "Mine.", "COLLABORATOR")],
      reviews: [by("stranger", "Also.", "NONE")],
    });

    const comments = sut.open();

    assert.deepEqual(comments, [{ kind: "conversation", author: "vietanh253", body: "Mine.", replies: [] }]);
  });

  test("conversation comments and review bodies are all fed on the first Revision, oldest first, without the loop's own or empty ones", () => {
    const sut = makeSUT({
      comments: [by("knn90", "Second.", "OWNER", "2026-10-02T02:00:00Z"), by("knn90", "<!-- afk-loop -->\nRevision skipped.", "OWNER", "2026-10-02T03:00:00Z")],
      reviews: [by("knn90", "First.", "OWNER", "2026-10-02T01:00:00Z"), by("knn90", "", "OWNER", "2026-10-02T04:00:00Z")],
    });

    const comments = sut.open();

    assert.deepEqual(bodies(comments), ["First.", "Second."]);
  });

  test("only what is newer than the last Revision's summary comment is fed again", () => {
    const sut = makeSUT({
      comments: [
        by("knn90", "Old.", "OWNER", "2026-10-02T01:00:00Z"),
        by("knn90", "<!-- afk-loop:revision-summary -->\n\nRevision 1", "OWNER", "2026-10-02T02:00:00Z"),
        by("knn90", "New.", "OWNER", "2026-10-02T03:00:00Z"),
      ],
      reviews: [by("knn90", "Old review.", "OWNER", "2026-10-02T01:30:00Z"), by("knn90", "New review.", "OWNER", "2026-10-02T04:00:00Z")],
    });

    const comments = sut.open();

    assert.deepEqual(bodies(comments), ["New.", "New review."]);
  });

  test("a stranger's comment carrying the summary marker hides nothing", () => {
    const sut = makeSUT({
      comments: [
        by("knn90", "Mine.", "OWNER", "2026-10-02T01:00:00Z"),
        by("stranger", "<!-- afk-loop:revision-summary -->\n\nRevision 1", "NONE", "2026-10-02T02:00:00Z"),
      ],
    });

    const comments = sut.open();

    assert.deepEqual(bodies(comments), ["Mine."]);
  });
});

describe("revisionNumber", () => {
  test("counts the loop's earlier comments on the PR", () => {
    const comments = [by("knn90", "Looks good"), by("knn90", "<!-- afk-loop -->\nhanded off"), by("knn90", "<!-- afk-loop:revision-summary -->\n\nRevision 2")];

    const number = revisionNumber(comments);

    assert.equal(number, 3);
  });

  test("a stranger's comment carrying a loop marker isn't counted", () => {
    const comments = [by("stranger", "<!-- afk-loop -->\nhanded off", "NONE")];

    const number = revisionNumber(comments);

    assert.equal(number, 1);
  });

  test("the first Revision is number 1", () => {
    const number = revisionNumber([]);

    assert.equal(number, 1);
  });
});

// MARK: - Helpers

function makeSUT(pullRequest: Partial<PullRequestComments>) {
  return { open: () => openReviewComments({ threads: [], comments: [], reviews: [], ...pullRequest }) };
}

function bodies(comments: readonly { body: string }[]): string[] {
  return comments.map((comment) => comment.body);
}

function by(login: string, body: string, authorAssociation = "OWNER", at = "2026-10-02T00:00:00Z") {
  return { author: { login }, authorAssociation, body, at };
}
