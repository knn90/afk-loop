import type { Issue } from "./afk-loop.js";
import { completionSignal, glossaryRule, issueBlock, lastBlock } from "./prompt-parts.js";
import { skill } from "./skills-plugin.js";

export interface DraftBrief {
  readonly repo: string;
  readonly issue: Issue;
  readonly branch: string;
  readonly base: string;
  readonly testRun: string;
}

export function pullRequestDraft(reply: string): string | undefined {
  return lastBlock(reply, "pr-body");
}

export function drafterPrompt({ repo, issue, branch, base, testRun }: DraftBrief): string {
  return `You are the Drafter for issue #${issue.number} of ${repo}, working on branch \`${branch}\`. The Implementer's and the Reviewer's work on it is committed and passed the Test run.

${issueBlock(issue)}

<test-run>
${testRun}
</test-run>

How to work:

- Invoke the \`${skill("pr")}\` skill with the Skill tool and draft the PR body for \`git diff ${base}...HEAD\`.
- ${glossaryRule}
- The draft starts at \`## Summary\` and names other issues as \`Refs #n\`. The Host puts \`Closes #${issue.number}.\` above it, and the Reviewer's unfixed findings and the Test run result below it.
- Evidence: the After is <test-run>; beside it, quote only output of commands you run in this Sandbox.
- The branch stays at the commit the Test run passed: your reply is your only output.

Done means the draft is in your reply between \`<pr-body>\` and \`</pr-body>\`. Then reply with ${completionSignal}.`;
}
