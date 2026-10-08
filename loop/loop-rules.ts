export const readyForAgent = "ready-for-agent";
export const readyForHuman = "ready-for-human";
export const attemptBudget = 3;
export const dirtyFeedback = "Your last run left uncommitted changes. Commit all changes: the Test run only takes a clean HEAD.";
export const unchangedHeadFeedback = "Your last run made no new commits, so these failures still stand:";
const maxFencedChars = 60_000;

export function fenced(text: string): string {
  const bounded = text.length > maxFencedChars ? `${text.slice(0, maxFencedChars)}\n… truncated` : text;
  const longestBacktickRun = Math.max(2, ...(bounded.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestBacktickRun + 1);
  return `${fence}text\n${bounded}\n${fence}`;
}

export const loopMarker = "<!-- afk-loop -->";
export const revisionSummaryMarker = "<!-- afk-loop:revision-summary -->";

export const budgetSpentWhy = `the Attempt budget (${attemptBudget}) ran out without a green Test run`;

export function lastAttemptDetails(log: string, rawLog?: string): string {
  const rawLogNote = rawLog ? ` (Test run output filtered; raw log on the Host: \`${rawLog}\`)` : "";
  return `Feedback from the last Attempt${rawLogNote}:\n\n${fenced(log)}`;
}
