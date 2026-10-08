import type { Issue } from "./afk-loop.js";
import { linkedIssueBlock } from "./linked-issues.js";
import type { Project } from "./loop-config.js";
import { folder, type Platform } from "./platforms.js";

export const completionSignal = "<promise>COMPLETE</promise>";

export const glossaryRule = "Read GLOSSARY.md and use its vocabulary; if GLOSSARY-MAP.md exists, follow it to the context you change.";

export function lastBlock(reply: string, tag: string): string | undefined {
  const blocks = [...reply.matchAll(new RegExp(`<${tag}>((?:(?!<${tag}>)[\\s\\S])*?)</${tag}>`, "g"))];
  return blocks.at(-1)?.[1]?.trim() || undefined;
}

export function issueBlock(issue: Issue): string {
  const linked = (issue.linkedIssues ?? []).map((linkedIssue) => `\n\n${linkedIssueBlock(linkedIssue)}`).join("");
  return `<issue>
# ${issue.title}

${issue.body}
</issue>${linked}`;
}

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

export const doneTail = `all committed, and \`git status\` is clean. Then reply with ${completionSignal}.`;
