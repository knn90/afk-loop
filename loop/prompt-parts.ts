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

function sandboxBuilds({ image, platforms }: Project): string {
  const vm = image.tools ? `a macOS VM with ${image.tools}` : "a macOS VM";
  const builds = platforms.map((platform) => `for \`${folder(platform)}\`, ${platform.agentBuildHint}`).join("; ");
  return `- This Sandbox is ${vm}. Build and test your work before you finish: ${builds}. The loop's Test run follows your run and decides: it covers ${testRunCovers(platforms)}, with any failures returned to you.`;
}

export function sandboxLimits(project: Project): string {
  return `${sandboxBuilds(project)}
- The Host pushes, opens the PR and updates the issue: this Sandbox has no GitHub access.`;
}

export const doneTail = `all committed, and \`git status\` is clean. Then reply with ${completionSignal}.`;
