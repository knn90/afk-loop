import type { Issue } from "./afk-loop.js";
import type { Project } from "./loop-config.js";
import { changesNoPlatform } from "./platforms.js";
import { sandboxLimits, doneTail, hostFeedbackBlock, issueBlock, lastBlock, glossaryRule } from "./prompt-parts.js";
import { skill } from "./skills-plugin.js";

export interface ReviewBrief {
  readonly project: Project;
  readonly issue: Issue;
  readonly branch: string;
  readonly base: string;
  readonly standards: readonly string[];
  readonly feedback?: string;
}

export function hasOpenFindings(reply: string): boolean {
  const counts = [...reply.matchAll(/<open-findings>(\d+)<\/open-findings>/g)];
  return counts.at(-1)?.[1] !== "0";
}

export function unfixedFindings(reply: string): string | undefined {
  return lastBlock(reply, "unfixed-findings");
}

export function pullRequestDraft(reply: string): string | undefined {
  return lastBlock(reply, "pr-body");
}

export function reviewerPrompt({ project, issue, branch, base, standards, feedback }: ReviewBrief): string {
  const task = feedback
    ? `- Your review of this branch is done and its fixes are committed (\`git log ${base}..HEAD\`). Fix only what <host-feedback> reports.`
    : `- Invoke the \`${skill("code-review")}\` skill with the Skill tool. Its inputs are all here:
  - Fixed point: \`${base}\`, so the diff is \`git diff ${base}...HEAD\`.
  - Spec: the <issue> block.
  - Standards: the <coding-standards> block.
  - Then invoke the \`${skill("codebase-design")}\` skill and review Design in its vocabulary: put every module the diff adds or reshapes to the deletion test, and record each shallow module, hypothetical seam and test that reaches past an interface as a Design finding.
  - Fix every Spec, Standards and Design finding on this branch. A finding you judge wrong, or a deepening that reaches beyond this diff, stays unfixed.
  - List every finding you left unfixed, one bullet each with its reason, between \`<unfixed-findings>\` and \`</unfixed-findings>\`. The maintainer reads this list in the PR.
  - An unfixed finding is open when the maintainer must decide it. One the <issue> itself settles, or that belongs to a later issue, is listed and not open.
  - End your reply with \`<open-findings>N</open-findings>\`, N being the number of open findings, 0 when there are none.`;
  const done = feedback ? "every failure in <host-feedback> is fixed" : "every finding is fixed or answered";

  return `You are the Reviewer for issue #${issue.number} of ${project.repo}, working on branch \`${branch}\`. The Implementer's work on it passed the Test run.

${issueBlock(issue)}

<coding-standards>
${standards.length > 0 ? standards.join("\n\n") : `None apply: this branch ${changesNoPlatform(project.platforms)}.`}
</coding-standards>${hostFeedbackBlock(feedback)}

How to work:

${task}
- Then invoke the \`${skill("pr")}\` skill with the Skill tool and draft the PR body for \`git diff ${base}...HEAD\` as your commits leave it.
  - The draft starts at \`## Summary\` and names other issues as \`Refs #n\`. The Host puts \`Closes #${issue.number}.\` above it and its own lines below it.
  - Evidence: quote only output of commands you run in this Sandbox. The Host adds what the Test run verified.
- ${glossaryRule} Follow docs/agents/git-conventions.md.
${sandboxLimits(project)}
- Commit every fix on this branch as \`[#${issue.number}] - Imperative summary\`.

Done means ${done}, the draft is in your reply between \`<pr-body>\` and \`</pr-body>\`, ${doneTail}`;
}
