import type { Issue, LinkedIssue } from "./afk-loop.js";

export const linkedIssueLimit = 5;
export const linkedIssueCharLimit = 20_000;
export const truncationMark = "… truncated";
const relationSections = /^(parent|blocked by)$/i;
const issueLink = /(?<![\w/])#(\d+)\b|\/issues\/(\d+)\b/g;

function namedOutsideRelationSections(text: string): number[] {
  const numbers: number[] = [];
  let inRelationSection = false;
  for (const line of text.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.*?)\s*$/)?.[1];
    if (heading !== undefined) inRelationSection = relationSections.test(heading);
    if (inRelationSection) continue;
    for (const link of line.matchAll(issueLink)) numbers.push(Number(link[1] ?? link[2]));
  }
  return numbers;
}

export function linkedIssueNumbers(issue: Pick<Issue, "number" | "body" | "comments">): number[] {
  const numbers = new Set([issue.body, ...(issue.comments ?? [])].flatMap(namedOutsideRelationSections));
  numbers.delete(issue.number);
  return [...numbers].slice(0, linkedIssueLimit);
}

export function linkedIssueBlock(linked: LinkedIssue): string {
  const text = [`# ${linked.title}`, linked.body, ...linked.comments].join("\n\n");
  const shown = text.length > linkedIssueCharLimit ? `${text.slice(0, linkedIssueCharLimit)}\n${truncationMark}` : text;
  return `<linked-issue number="${linked.number}">\n${shown}\n</linked-issue>`;
}
