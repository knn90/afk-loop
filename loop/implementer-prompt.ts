import type { Issue } from "./afk-loop.js";
import type { Project } from "./loop-config.js";
import { sandboxLimits, committed, hostFeedbackBlock, issueBlock, lastBlock, replyBlocks, standardsByFolder, glossaryRule } from "./prompt-parts.js";
import { skill } from "./skills-plugin.js";

export function findingsLeft(reply: string): string | undefined {
  return lastBlock(reply, "findings-left");
}

export function contradiction(reply: string): string | undefined {
  return lastBlock(reply, "contradiction");
}

const contradictionRule = `- First read the <issue> as one text: its body, then its <comment> blocks in posting order. Where a comment says which part holds, follow the comment. Two parts that disagree, with nothing saying which holds, are a Contradiction: write no code, commit nothing, and quote both parts in the <contradiction> block. The Host returns the issue to the maintainer.
`;

const orContradiction = "; or, on a Contradiction, nothing is committed and both parts are in the <contradiction> block";

function fixRoundBlock(fixableFindings: string, feedback?: string): string {
  const rejected = feedback ? `\n\nYour last run in this Fix round was rejected; its commits are on this branch. Fix this too:\n\n<host-feedback>\n${feedback}\n</host-feedback>` : "";
  return `

Your work on this issue passed the Test run and the Reviewer reviewed it. This is your one Fix round: fix the Reviewer's Fixable findings.

<fixable-findings>
${fixableFindings}
</fixable-findings>${rejected}`;
}

const fixRoundRules = `- Fix only the findings in <fixable-findings>: the Reviewer reviews this round's commits once more, and nothing they add gets another Fix round.
- You may leave a finding you judge wrong: change nothing for it. List each finding you left in this Fix round, and why, in the <findings-left> block. The Host passes the block to the Reviewer.
`;

function workTestFirst(fixRound: boolean): string {
  return fixRound
    ? "fix each finding test-first with it: where a fix changes behaviour, a test that would fail without it, in the test framework those standards name, then the fix"
    : "work the issue test-first with it: for each behaviour the issue asks for, a test that would fail without it, in the test framework those standards name, then the code that makes it pass";
}

export function implementerPrompt(project: Project, issue: Issue, branch: string, feedback?: string, fixableFindings?: string): string {
  const feedbackDone = feedback ? ", every failure in <host-feedback> is fixed" : "";
  const done = fixableFindings
    ? `every finding in <fixable-findings> is fixed or is in <findings-left> with why${feedbackDone}`
    : `every acceptance criterion in the issue has a test and the code for it${feedbackDone}`;
  const ending = fixableFindings
    ? replyBlocks(["findings-left"], "An empty block means you left none.")
    : replyBlocks(["contradiction"], "An empty block means the issue has no Contradiction.");

  return `You are the Implementer for issue #${issue.number} of ${project.repo}, working on branch \`${branch}\`.

${issueBlock(issue)}${fixableFindings ? fixRoundBlock(fixableFindings, feedback) : hostFeedbackBlock(feedback)}

How to work:

${fixableFindings ? "" : contradictionRule}- ${glossaryRule} Follow ${standardsByFolder(project.platforms)} and docs/agents/git-conventions.md.
- Invoke the \`${skill("tdd")}\` skill with the Skill tool and ${workTestFirst(fixableFindings !== undefined)}.
${fixableFindings ? fixRoundRules : ""}${sandboxLimits(project)}
- Commit every change on this branch as \`[#${issue.number}] - Imperative summary\`.

Done means ${done}, ${committed}${fixableFindings ? "" : orContradiction}. ${ending}`;
}
