import type { Issue, OpenFinding } from "./afk-loop.js";
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

export function openFindings(reply: string): OpenFinding[] {
  const findings = lastBlock(reply, "open-findings") ?? "";
  return [...findings.matchAll(/<finding([^>]*)>([\s\S]*?)<\/finding>/g)].map(([, attributes = "", text = ""]) => {
    const path = attributes.match(/\bpath="([^"]+)"/)?.[1];
    const line = attributes.match(/\bline="(\d+)"/)?.[1];
    return { text: text.trim(), ...(path && line ? { at: { path, line: Number(line) } } : {}) };
  });
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
  - A point the <issue>'s own text settles is not a finding: do not report it. A real problem that is not this issue's work is an Open finding.
  - Every finding you left unfixed is an Open finding: the maintainer must decide it. Give them in your reply between \`<open-findings>\` and \`</open-findings>\`, one each, as \`<finding path="path/to/file" line="12">The finding, and why you left it.</finding>\`. With none, leave the block empty.
  - \`path\` is from the repo root and \`line\` is a line on the new side of \`git diff ${base}...HEAD\`, as your fixes left it. Leave both out when the finding has no single line.
  - The Host posts each one as a review comment on the PR.`;
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
