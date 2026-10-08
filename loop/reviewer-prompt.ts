import type { FixRound, Issue, OpenFinding } from "./afk-loop.js";
import type { Project } from "./loop-config.js";
import { changesNoPlatform } from "./platforms.js";
import { completionSignal, glossaryRule, hasBlock, issueBlock, lastBlock, reviewerSandbox } from "./prompt-parts.js";
import { skill } from "./skills-plugin.js";

export interface ReviewBrief {
  readonly project: Project;
  readonly issue: Issue;
  readonly branch: string;
  readonly base: string;
  readonly standards: readonly string[];
}

export interface WrapUpBrief extends ReviewBrief {
  readonly fixRound: FixRound;
}

export function fixableFindings(reply: string): string | undefined {
  return lastBlock(reply, "fixable-findings");
}

export function openFindings(reply: string): OpenFinding[] {
  const findings = lastBlock(reply, "open-findings") ?? "";
  return [...findings.matchAll(/<finding([^>]*)>([\s\S]*?)<\/finding>/g)].map(([, attributes = "", text = ""]) => {
    const path = attributes.match(/\bpath="([^"]+)"/)?.[1];
    const line = attributes.match(/\bline="(\d+)"/)?.[1];
    return { text: text.trim(), ...(path ? { at: { path, ...(line ? { line: Number(line) } : {}) } } : {}) };
  });
}

export function wrapUpOpenFindings(reply: string): OpenFinding[] | undefined {
  return hasBlock(reply, "open-findings") ? openFindings(reply) : undefined;
}

export function pullRequestDraft(reply: string): string | undefined {
  return lastBlock(reply, "pr-body");
}

const readOnly = "- You change no file and commit nothing. The Host puts the branch back at the commit the Test run passed, whatever your run leaves behind.";

function openFindingsFormat(base: string): string {
  return `one each, as \`<finding path="path/to/file" line="12">The finding, and why the maintainer must decide it.</finding>\`. With none, leave the block empty.
  - \`path\` is from the repo root and \`line\` is a line on the new side of \`git diff ${base}...HEAD\`. Leave both out when the finding has no single line.
  - The Host posts each one as a review comment on the PR.`;
}

function draftRules(issue: Issue): string {
  return `  - The draft starts at \`## Summary\` and names other issues as \`Refs #n\`. The Host puts \`Closes #${issue.number}.\` above it and its own lines below it.
  - Evidence: quote only output of commands you run in this Sandbox. The Host adds what the Test run verified.`;
}

function standardsBlock(project: Project, standards: readonly string[]): string {
  return `<coding-standards>
${standards.length > 0 ? standards.join("\n\n") : `None apply: this branch ${changesNoPlatform(project.platforms)}.`}
</coding-standards>`;
}

export function reviewerPrompt({ project, issue, branch, base, standards }: ReviewBrief): string {
  return `You are the Reviewer for issue #${issue.number} of ${project.repo}, working on branch \`${branch}\`. The Implementer's work on it passed the Test run.

${issueBlock(issue)}

${standardsBlock(project, standards)}

How to work:

${readOnly}
- Invoke the \`${skill("code-review")}\` skill with the Skill tool. Its inputs are all here:
  - Fixed point: \`${base}\`, so the diff is \`git diff ${base}...HEAD\`.
  - Spec: the <issue> block.
  - Standards: the <coding-standards> block.
  - Then invoke the \`${skill("codebase-design")}\` skill and review Design in its vocabulary: put every module the diff adds or reshapes to the deletion test, and record each shallow module, hypothetical seam and test that reaches past an interface as a Design finding.
- Sort every Spec, Standards and Design finding. A finding is Open when any of these holds; otherwise it is Fixable:
  - fixing it changes behaviour the issue asked for, or the issue does not say which way to go;
  - there is more than one reasonable fix, with different results for the user or for the design;
  - the fix reaches outside this diff: another module, or a later issue's work;
  - the Reviewer is not sure the finding is valid.
- There is no third kind. A point the <issue>'s own text settles is not a finding: do not report it. A real problem that is not this issue's work is an Open finding.
- Fixable findings: the Implementer fixes them in one Fix round, with no decision from the maintainer. Give them in your reply between \`<fixable-findings>\` and \`</fixable-findings>\`, as text for the Implementer: for each, its file and line, what is wrong and what fixed looks like. With none, leave the block empty.
- Open findings: the maintainer must decide them. Give them in your reply between \`<open-findings>\` and \`</open-findings>\`, ${openFindingsFormat(base)}
- With no Fixable finding, invoke the \`${skill("pr")}\` skill with the Skill tool and draft the PR body for \`git diff ${base}...HEAD\`. With a Fixable finding, draft none: you draft it after the Fix round.
${draftRules(issue)}
- ${glossaryRule}
${reviewerSandbox(project)}

Done means every finding is in one of the two blocks and, with no Fixable finding, the draft is in your reply between \`<pr-body>\` and \`</pr-body>\`. Then reply with ${completionSignal}.`;
}

function findingBlock({ text, at }: OpenFinding): string {
  const where = at ? ` path="${at.path}"${at.line ? ` line="${at.line}"` : ""}` : "";
  return `<finding${where}>${text}</finding>`;
}

const leftReason = "carrying the Implementer's reason from <findings-left> where it gave one";

export function wrapUpPrompt({ project, issue, branch, base, standards, fixRound }: WrapUpBrief): string {
  const { fixableFindings, openFindings, reviewedHead, findingsLeft, failed } = fixRound;
  const fixRoundEnded = failed
    ? `The Implementer then had one Fix round on your Fixable findings. It failed its Test run, so the Host dropped its commits: the branch is back at \`${reviewedHead}\`, the commit that passed the Test run, and none of your Fixable findings is fixed.`
    : `The Implementer then had one Fix round on your Fixable findings: its commits are \`git log ${reviewedHead}..HEAD\`, and there may be none. The branch passed the Test run.`;
  const review = failed
    ? `- Review nothing again: no commit follows the one you reviewed. Report no Fixable finding: there is no second Fix round.
- Every Fixable finding becomes an Open finding, ${leftReason}.
- Keep each of your Open findings as it is: the diff is the one you reviewed.`
    : `- Review the Fix round's commits only. Invoke the \`${skill("code-review")}\` skill with the Skill tool. Its inputs are all here:
  - Fixed point: \`${reviewedHead}\`, so the diff is \`git diff ${reviewedHead}...HEAD\`.
  - Spec: your Fixable findings and the <issue> block.
  - Standards: the <coding-standards> block.
  - With no commit after \`${reviewedHead}\` there is nothing to review: skip the skill.
- Do no Design review, and do not review the rest of the branch again.
- Every finding in the Fix round's commits is an Open finding, whatever its kind: there is no second Fix round, so report no Fixable finding.
- Check each Fixable finding against \`git diff ${base}...HEAD\`. One that was not fixed becomes an Open finding, ${leftReason}.
- Restate each of your Open findings against that diff: its text as it holds now, its \`path\` and \`line\` as HEAD has them.`;
  const finalOpenFindings = failed ? "yours and every Fixable finding" : "yours restated, each Fixable finding not fixed and each finding in the Fix round's commits";
  const checked = failed ? "every Fixable finding is an Open finding" : "the Fix round's commits are reviewed, every Fixable finding is checked";

  return `You are the Reviewer for issue #${issue.number} of ${project.repo}, wrapping up your review of branch \`${branch}\`. You reviewed it at \`${reviewedHead}\`. ${fixRoundEnded}

${issueBlock(issue)}
${failed ? "" : `\n${standardsBlock(project, standards)}\n`}
Your Fixable findings:

<fixable-findings>
${fixableFindings}
</fixable-findings>

Your Open findings:

<open-findings>
${openFindings.map(findingBlock).join("\n")}
</open-findings>

The findings the Implementer left, and why:

<findings-left>
${findingsLeft ?? ""}
</findings-left>

How to work:

${readOnly}
${review}
- Give the final Open findings, ${finalOpenFindings}, in your reply between \`<open-findings>\` and \`</open-findings>\`, ${openFindingsFormat(base)}
- Then invoke the \`${skill("pr")}\` skill with the Skill tool and draft the PR body for \`git diff ${base}...HEAD\`.
${draftRules(issue)}
- ${glossaryRule}
${reviewerSandbox(project)}

Done means ${checked}, the final Open findings are in your reply, and the draft is in your reply between \`<pr-body>\` and \`</pr-body>\`. Then reply with ${completionSignal}.`;
}
