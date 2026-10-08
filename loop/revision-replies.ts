import type { NumberedComment } from "./afk-loop.js";

export const verdicts = ["fixed", "declined", "question"] as const;
export type Verdict = (typeof verdicts)[number];

export interface Reply {
  readonly comment: NumberedComment;
  readonly verdict: Verdict;
  readonly text: string;
}

const replyLine = new RegExp(`^[\\s>*|-]*<?(C\\d+)>?\\s*\\|[\\s\`*]*(${verdicts.join("|")})[\\s\`*]*\\|\\s*(\\S.*?)\\s*\\|?\\s*$`, "gim");

export function repliesTemplate(comments: readonly NumberedComment[]): string {
  const rows = comments.map((comment) => `${comment.id} | ${verdicts.slice(0, -1).join(", ")} or ${verdicts.at(-1)} | your reply, on one line`);
  return `<replies>\n${rows.join("\n")}\n</replies>`;
}

export function readReplies(output: string, comments: readonly NumberedComment[]): { replies: Reply[]; unanswered: NumberedComment[] } {
  const block = [...output.matchAll(/<replies>([\s\S]*?)<\/replies>/g)].at(-1)?.[1] ?? "";
  const answers = new Map(
    [...block.matchAll(replyLine)].map(([, id, verdict, text]) => [id!.toUpperCase(), { verdict: verdict!.toLowerCase() as Verdict, text: text! }]),
  );
  const replies = comments.flatMap((comment) => {
    const answer = answers.get(comment.id);
    return answer ? [{ comment, ...answer }] : [];
  });
  return { replies, unanswered: comments.filter((comment) => !answers.has(comment.id)) };
}

export function unansweredFeedback(unanswered: readonly NumberedComment[], comments: readonly NumberedComment[]): string {
  const ids = unanswered.map((comment) => comment.id).join(", ");
  return `Your reply has no readable verdict for ${ids}. End it with one plain-text line per comment, in this block:\n\n${repliesTemplate(comments)}`;
}
