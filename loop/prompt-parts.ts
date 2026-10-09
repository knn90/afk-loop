import type { Issue } from "./afk-loop.js";
import { linkedIssueBlock } from "./linked-issues.js";
import type { Project } from "./loop-config.js";
import { folder, type Platform } from "./platforms.js";

export const completionSignal = "<promise>COMPLETE</promise>";

export const glossaryRule = "Read GLOSSARY.md and use its vocabulary; if GLOSSARY-MAP.md exists, follow it to the glossary of the code you work on.";

function blocks(reply: string, tag: string): RegExpExecArray[] {
  return [...reply.matchAll(new RegExp(`<${tag}>((?:(?!<${tag}>)[\\s\\S])*?)</${tag}>`, "g"))];
}

export function innerBlocks(text: string, tag: string): string[] {
  return blocks(text, tag).map((block) => block[1]?.trim() ?? "");
}

export function lastBlock(reply: string, tag: string): string | undefined {
  const text = blocks(reply, tag).at(-1)?.[1]?.trim();
  return text && !/^none\.?$/i.test(text) ? text : undefined;
}

export function replyBlocks(tags: readonly string[], empty: string): string {
  const [these, theirTags] = tags.length > 1 ? ["these blocks, each once and in this order", "these tags"] : ["this block, once", "its tags"];
  return `End your reply with ${these}, then ${completionSignal}. ${empty} Write ${theirTags} nowhere else in your reply.

${tags.map((tag) => `<${tag}>\n</${tag}>`).join("\n")}`;
}

export function hasBlock(reply: string, tag: string): boolean {
  return blocks(reply, tag).length > 0;
}

function commentBlocks(comments: readonly string[]): string {
  return comments.map((comment) => `\n\n<comment>\n${comment}\n</comment>`).join("");
}

export function issueBlock(issue: Issue): string {
  const linked = (issue.linkedIssues ?? []).map((linkedIssue) => `\n\n${linkedIssueBlock(linkedIssue)}`).join("");
  return `<issue>
# ${issue.title}

${issue.body}${commentBlocks(issue.comments ?? [])}
</issue>${linked}`;
}

export const readIssueFirst =
  "First read the <issue> as one text: its body, then its <comment> blocks in posting order. Where a comment says which part holds, follow the comment. Two parts that disagree, with nothing saying which holds, are a Contradiction";

export function hostFeedbackBlock(feedback?: string): string {
  return feedback
    ? `

Your last run was rejected. Fix this first:

<host-feedback>
${feedback}
</host-feedback>`
    : "";
}

export function standardsByFolder(platforms: readonly Platform[]): string {
  return `the coding standards for the folder you change (${platforms.map((platform) => `${platform.standards} for \`${folder(platform)}\``).join(", ")})`;
}

const counts = ["", "one", "two", "three", "four", "five"];

function testRunCovers(platforms: readonly Platform[]): string {
  const [only] = platforms;
  if (platforms.length === 1 && only) return `\`${folder(only)}\` when your branch changes it`;
  return `each of the ${counts[platforms.length] ?? platforms.length} folders your branch changes`;
}

function sandboxVm({ image }: Project): string {
  return image.tools ? `a macOS VM with ${image.tools}` : "a macOS VM";
}

function buildHints({ platforms }: Project): string {
  return platforms.map((platform) => `for \`${folder(platform)}\`, ${platform.agentBuildHint}`).join("; ");
}

function sandboxBuilds(project: Project): string {
  return `- This Sandbox is ${sandboxVm(project)}. Build and test your work before you finish: ${buildHints(project)}. The loop's Test run follows your run and decides: it covers ${testRunCovers(project.platforms)}, with any failures returned to you.`;
}

export function reviewerSandbox(project: Project): string {
  return `- This Sandbox is ${sandboxVm(project)}. To check a finding you may build and test: ${buildHints(project)}. No Test run follows your run.
- The Host pushes, opens the PR and posts your Open findings: this Sandbox has no GitHub access.`;
}

export function sandboxLimits(project: Project): string {
  return `${sandboxBuilds(project)}
- The Host pushes, opens the PR and updates the issue: this Sandbox has no GitHub access.`;
}

export const committed = "all committed, and `git status` is clean";
