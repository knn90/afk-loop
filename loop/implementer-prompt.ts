import type { Issue } from "./afk-loop.js";
import type { Project } from "./loop-config.js";
import { sandboxLimits, doneTail, hostFeedbackBlock, issueBlock, lastBlock, standardsByFolder, glossaryRule } from "./prompt-parts.js";
import { skill } from "./skills-plugin.js";

export function findingsLeft(reply: string): string | undefined {
  return lastBlock(reply, "findings-left");
}

function fixRoundBlock(fixableFindings: string, feedback?: string): string {
  const rejected = feedback ? `\n\nYour last run in this Fix round was rejected. Fix this too:\n\n${feedback}` : "";
  return `

Your work on this issue passed the Test run and the Reviewer reviewed it. This is your one Fix round: fix the Reviewer's Fixable findings.

<host-feedback>
${fixableFindings}${rejected}
</host-feedback>`;
}

const fixRoundRules = `- Fix only the findings in <host-feedback>, each with the test it needs. Add nothing else: the Reviewer reviews this round's commits once more, and nothing they add gets another Fix round.
- You may leave a finding you judge wrong: change nothing for it. End your reply with each finding you left and why, between \`<findings-left>\` and \`</findings-left>\`. With none, leave the block empty. The Host passes the block to the Reviewer.
`;

export function implementerPrompt(project: Project, issue: Issue, branch: string, feedback?: string, fixableFindings?: string): string {
  const feedbackDone = feedback ? ", every failure in <host-feedback> is fixed" : "";
  const done = fixableFindings
    ? `every finding in <host-feedback> is fixed or is in <findings-left> with why${feedback ? ", the rejection there is fixed" : ""}`
    : `every acceptance criterion in the issue has a test and the code for it${feedbackDone}`;

  return `You are the Implementer for issue #${issue.number} of ${project.repo}, working on branch \`${branch}\`.

${issueBlock(issue)}${fixableFindings ? fixRoundBlock(fixableFindings, feedback) : hostFeedbackBlock(feedback)}

How to work:

- ${glossaryRule} Follow ${standardsByFolder(project.platforms)} and docs/agents/git-conventions.md.
- Invoke the \`${skill("tdd")}\` skill with the Skill tool and work the issue test-first with it: for each behaviour the issue asks for, a test that would fail without it, in the test framework those standards name, then the code that makes it pass.
${fixableFindings ? fixRoundRules : ""}${sandboxLimits(project)}
- Commit every change on this branch as \`[#${issue.number}] - Imperative summary\`.

Done means ${done}, ${doneTail}`;
}
