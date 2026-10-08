import type { FirstReview, FixRound, Issue, OpenFinding } from "./afk-loop.js";
import type { Project } from "./loop-config.js";
import { changesNoPlatform } from "./platforms.js";
import { glossaryRule, hasBlock, issueBlock, lastBlock, replyBlocks, reviewerSandbox } from "./prompt-parts.js";
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

export function answeredOpenFindings(reply: string): OpenFinding[] | undefined {
  if (!hasBlock(reply, "open-findings")) return undefined;
  const findings = openFindings(reply);
  const unreadable = findings.length === 0 && lastBlock(reply, "open-findings") !== undefined;
  return unreadable ? undefined : findings;
}

export function pullRequestDraft(reply: string): string | undefined {
  return lastBlock(reply, "pr-body");
}

export function firstReview(reply: string): Omit<FirstReview, "log"> {
  const open = answeredOpenFindings(reply);
  if (!open || !hasBlock(reply, "fixable-findings")) return { openFindings: [], unreadable: true };
  const fixable = fixableFindings(reply);
  const draft = pullRequestDraft(reply);
  return { openFindings: open, ...(fixable ? { fixableFindings: fixable } : {}), ...(draft ? { pullRequestDraft: draft } : {}) };
}

const readOnly = "- You change no file and commit nothing. The Host puts the branch back at the commit the Test run passed, whatever your run leaves behind.";

const openFindingsFormat = `one each, as \`<finding path="path/to/file" line="12">The finding, and why the maintainer must decide it.</finding>\`.
  - \`path\` is from the repo root and \`line\` is a line on the new side of the branch diff. Leave both out when the finding has no single line.
  - The Host posts each one as a review comment on the PR.`;

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
  - Fixed point: \`${base}\`, so the diff is the branch diff, \`git diff ${base}...HEAD\`.
  - Spec: the <issue> block.
  - Standards: the <coding-standards> block.
- Then invoke the \`${skill("codebase-design")}\` skill and review Design in its vocabulary: put every module the diff adds or reshapes to the deletion test, and record each shallow module, hypothetical seam and test that reaches past an interface as a Design finding.
- Sort every Spec, Standards and Design finding: each is Open or Fixable. A finding is Open when any of these holds; otherwise it is Fixable:
  - fixing it changes behaviour the issue asked for, or the issue does not say which way to go;
  - there is more than one reasonable fix, with different results for the user or for the design;
  - the fix reaches outside this diff: another module, or a later issue's work;
  - you are not sure the finding is valid.
- A real problem that is not this issue's work is an Open finding. A point the <issue>'s own text settles is not a finding: leave it out.
- Fixable findings: the Implementer fixes them in one Fix round, with no decision from the maintainer. Write them as text for the Implementer: for each, its file and line, what is wrong and what fixed looks like.
- Open findings: the maintainer must decide them. Write them ${openFindingsFormat}
- With no Fixable finding, invoke the \`${skill("pr")}\` skill with the Skill tool and draft the PR body for the branch diff. With a Fixable finding, draft none: you draft it after the Fix round.
${draftRules(issue)}
- ${glossaryRule}
${reviewerSandbox(project)}

Done means every finding is in one of the two findings blocks and, with no Fixable finding, the draft is in the <pr-body> block.

${replyBlocks(["fixable-findings", "open-findings", "pr-body"], "An empty block means none.")}`;
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
    ? `- The branch is the one you reviewed, so there is nothing to review.
- Every Fixable finding becomes an Open finding, ${leftReason}.
- Keep each of your Open findings as it is.`
    : `- With no commit after \`${reviewedHead}\`, go to the next step. Otherwise review the Fix round's commits only: invoke the \`${skill("code-review")}\` skill with the Skill tool. Its inputs are all here:
  - Fixed point: \`${reviewedHead}\`, so the diff is \`git diff ${reviewedHead}...HEAD\`.
  - Spec: your Fixable findings and the <issue> block.
  - Standards: the <coding-standards> block.
- Every finding in the Fix round's commits is an Open finding, whatever its kind: this was the one Fix round.
- Check each Fixable finding against the branch diff. One that was not fixed becomes an Open finding, ${leftReason}.
- Restate each of your Open findings against the branch diff: its text as it holds now, its \`path\` and \`line\` as HEAD has them.`;
  const finalOpenFindings = failed ? "yours and every Fixable finding" : "yours restated, each Fixable finding not fixed and each finding in the Fix round's commits";
  const checked = failed ? "every Fixable finding is an Open finding" : "the Fix round's commits are reviewed, every Fixable finding is checked";

  return `You are the Reviewer for issue #${issue.number} of ${project.repo}, on the Wrap-up of your review of branch \`${branch}\`. You reviewed it at \`${reviewedHead}\`. ${fixRoundEnded} The branch diff is \`git diff ${base}...HEAD\`.

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
- The final Open findings are ${finalOpenFindings}. Write them ${openFindingsFormat}
- Then invoke the \`${skill("pr")}\` skill with the Skill tool and draft the PR body for the branch diff.
${draftRules(issue)}
- ${glossaryRule}
${reviewerSandbox(project)}

Done means ${checked}, every final Open finding is in the <open-findings> block and the draft is in the <pr-body> block.

${replyBlocks(["open-findings", "pr-body"], "An empty <open-findings> block means none.")}`;
}
