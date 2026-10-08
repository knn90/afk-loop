import type { Issue, NumberedComment } from "./afk-loop.js";
import type { Project } from "./loop-config.js";
import { completionSignal, glossaryRule, hostFeedbackBlock, issueBlock, revisionSandboxLimits, standardsByFolder } from "./prompt-parts.js";
import { repliesTemplate } from "./revision-replies.js";
import { skill } from "./skills-plugin.js";

export interface RevisionBrief {
  readonly project: Project;
  readonly issue: Issue;
  readonly pullRequest: number;
  readonly branch: string;
  readonly base: string;
  readonly comments: readonly NumberedComment[];
  readonly feedback?: string;
}

function commentBlock(comment: NumberedComment): string {
  const inline = comment.kind === "inline";
  const place = inline ? ` path="${comment.path}"${comment.line ? ` line="${comment.line}"` : ""}` : "";
  const hunk = inline ? `<diff-hunk>\n${comment.diffHunk}\n</diff-hunk>\n` : "";
  const said = [comment, ...comment.replies].map(({ author, body }) => `<said by="${author}">\n${body}\n</said>`);
  return `<comment id="${comment.id}"${place}>\n${hunk}${said.join("\n")}\n</comment>`;
}

export function revisionPrompt({ project, issue, pullRequest, branch, base, comments, feedback }: RevisionBrief): string {
  const feedbackDone = feedback ? ", every failure in <host-feedback> is fixed" : "";
  const ids = comments.map((comment) => comment.id).join(", ");
  const earlierRuns = feedback
    ? "\n- Your earlier runs of this Revision already committed on this branch. A comment that no longer applies because one of those commits fixed it keeps `fixed`."
    : "";

  return `You are the Implementer revising PR #${pullRequest} for issue #${issue.number} of ${project.repo}, on branch \`${branch}\`. The maintainer reviewed the PR; their open comments follow the issue.

${issueBlock(issue)}

<review-comments>
${comments.map(commentBlock).join("\n")}
</review-comments>${hostFeedbackBlock(feedback)}

How to work:

- ${glossaryRule} Follow ${standardsByFolder(project.platforms)} and docs/agents/git-conventions.md.
- Give every comment a verdict before you edit anything. A comment is valid when all three checks hold, taken in order:
  1. It still applies to the current code.
  2. It agrees with the <issue>, those coding standards and GLOSSARY.md. A comment that contradicts them is \`declined\`, citing the rule.
  3. Its fix belongs to this PR's change (\`git diff ${base}...HEAD\`, plus any new file that change needs) and stays outside build configuration and loop tooling: package manifests, Xcode project files, scripts, \`.github/\`, \`.sandcastle/\`. A commit touching one of those hands the whole Revision off to the maintainer.
- The verdicts:
  - \`fixed\`: valid, and every ask in the comment is fixed on this branch.
  - \`declined\`: a check failed; your reply names the check and the evidence.
  - \`question\`: too unclear to act on; your reply asks the question.
  - A comment with several asks, only some of them fixable: fix those, and give \`declined\` or \`question\` with a reply naming what remains.${earlierRuns}
- Judge each comment on its own: a \`declined\` or \`question\` comment still gets its reply, and every other comment is still worked.
- Invoke the \`${skill("tdd")}\` skill with the Skill tool and fix the valid comments with it: a comment that changes behaviour gets its failing test first.
${revisionSandboxLimits(project)}
- Commit every change on this branch as \`[#${issue.number}] - Imperative summary\`.

Done means every comment has a verdict, every \`fixed\` comment's change is committed${feedbackDone}, and \`git status\` is clean. Then end your reply with this block, one plain-text line for each of ${ids} with its one verdict, followed by the completion signal:

${repliesTemplate(comments)}
${completionSignal}`;
}
