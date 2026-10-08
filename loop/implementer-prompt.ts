import type { Issue } from "./afk-loop.js";
import type { Project } from "./loop-config.js";
import { sandboxLimits, doneTail, hostFeedbackBlock, issueBlock, standardsByFolder, glossaryRule } from "./prompt-parts.js";
import { skill } from "./skills-plugin.js";

export function implementerPrompt(project: Project, issue: Issue, branch: string, feedback?: string): string {
  const feedbackDone = feedback ? ", every failure in <host-feedback> is fixed" : "";

  return `You are the Implementer for issue #${issue.number} of ${project.repo}, working on branch \`${branch}\`.

${issueBlock(issue)}${hostFeedbackBlock(feedback)}

How to work:

- ${glossaryRule} Follow ${standardsByFolder(project.platforms)} and docs/agents/git-conventions.md.
- Invoke the \`${skill("tdd")}\` skill with the Skill tool and work the issue test-first with it: for each behaviour the issue asks for, a test that would fail without it, in the test framework those standards name, then the code that makes it pass.
${sandboxLimits(project)}
- Commit every change on this branch as \`[#${issue.number}] - Imperative summary\`.

Done means every acceptance criterion in the issue has a test and the code for it${feedbackDone}, ${doneTail}`;
}
