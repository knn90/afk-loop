import type { CommentLine, ReviewComment } from "./afk-loop.js";
import { loopMarker, revisionSummaryMarker } from "./loop-rules.js";

export interface AuthoredComment {
  readonly author: { readonly login: string } | null;
  readonly authorAssociation: string;
  readonly body: string;
  readonly at?: string;
}

type Signed = Pick<AuthoredComment, "authorAssociation" | "body">;

export interface PullRequestComments {
  readonly threads: readonly {
    readonly id: string;
    readonly isResolved: boolean;
    readonly path: string;
    readonly line: number | null;
    readonly diffHunk: string;
    readonly comments: readonly AuthoredComment[];
  }[];
  readonly comments: readonly AuthoredComment[];
  readonly reviews: readonly AuthoredComment[];
}

const writeAccess = ["OWNER", "COLLABORATOR"];
const loopAuthor = "AFK loop";

export function hasWriteAccess(comment: Pick<Signed, "authorAssociation">): boolean {
  return writeAccess.includes(comment.authorAssociation);
}

function isRevisionSummary(comment: Signed): boolean {
  return hasWriteAccess(comment) && comment.body.startsWith(revisionSummaryMarker);
}

export function isLoopComment(comment: Signed): boolean {
  return isRevisionSummary(comment) || (hasWriteAccess(comment) && comment.body.startsWith(loopMarker));
}

function commentLine(comment: AuthoredComment): CommentLine {
  return isLoopComment(comment)
    ? { author: loopAuthor, body: comment.body.replace(/^<!--.*?-->/, "").trim() }
    : { author: comment.author?.login ?? "ghost", body: comment.body };
}

export function revisionNumber(comments: readonly Signed[]): number {
  return comments.filter(isLoopComment).length + 1;
}

export function openReviewComments({ threads, comments, reviews }: PullRequestComments): ReviewComment[] {
  const inline = threads
    .filter((thread) => !thread.isResolved)
    .flatMap((thread): ReviewComment[] => {
      const [first, ...replies] = thread.comments.filter(hasWriteAccess).map(commentLine);
      if (!first || first.author === loopAuthor) return [];
      const { id, path, line, diffHunk } = thread;
      return [{ kind: "inline", thread: id, ...first, path, ...(line ? { line } : {}), diffHunk, replies }];
    });

  const lastSummary = comments.findLast(isRevisionSummary)?.at ?? "";
  const conversation = [...comments, ...reviews]
    .filter((comment) => hasWriteAccess(comment) && !isLoopComment(comment) && comment.body.trim() !== "" && (comment.at ?? "") > lastSummary)
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
    .map((comment): ReviewComment => ({ kind: "conversation", ...commentLine(comment), replies: [] }));

  return [...inline, ...conversation];
}
