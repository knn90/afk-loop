import type { Issue, LinkedIssue, Tracker } from "./afk-loop.js";
import { check, gh, lines, repoUrl, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { readyForAgent } from "./loop-rules.js";
import { hasWriteAccess, isLoopComment } from "./review-comments.js";

interface RestIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  state: string;
  pull_request?: unknown;
  issue_dependencies_summary?: { blocked_by: number };
}

function openIssues(repo: string, filter = ""): Issue[] {
  const pages: RestIssue[][] = JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/issues?state=open${filter}&per_page=100`));
  return pages
    .flat()
    .filter((issue) => !issue.pull_request)
    .map(toIssue);
}

function toIssue(issue: RestIssue): Issue {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    labels: issue.labels.map((label) => label.name),
    openBlockers: issue.issue_dependencies_summary?.blocked_by ?? 0,
  };
}

interface RestComment {
  body: string | null;
  author_association: string;
}

function linkedIssue(repo: string, number: number): LinkedIssue[] {
  try {
    const issue: RestIssue = JSON.parse(gh("api", `repos/${repo}/issues/${number}`));
    const pages: RestComment[][] = JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/comments?per_page=100`));
    const comments = pages
      .flat()
      .map((comment) => ({ authorAssociation: comment.author_association, body: comment.body ?? "" }))
      .filter((comment) => hasWriteAccess(comment) && !isLoopComment(comment))
      .map((comment) => comment.body);
    return [{ number, title: issue.title, body: issue.body ?? "", comments }];
  } catch {
    return [];
  }
}

function issuesWithOpenPullRequest(repo: string): number[] {
  const pullRequests: { closingIssuesReferences: { number: number }[] }[] = JSON.parse(
    gh("pr", "list", "-R", repo, "--state", "open", "--limit", "200", "--json", "closingIssuesReferences"),
  );
  return pullRequests.flatMap((pullRequest) => pullRequest.closingIssuesReferences.map((issue) => issue.number));
}

function pushedBranches(repo: string): string[] {
  return lines(gh("api", "--paginate", `repos/${repo}/branches?per_page=100`, "--jq", ".[].name"));
}

const pollMs = 2000;
const pollLimit = 30;

async function waitWhile(pending: string, read: () => string): Promise<string> {
  for (let polls = 1; ; polls += 1) {
    const value = read().trim();
    if (value !== pending || polls >= pollLimit) return value;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function githubTracker({ repo, baseBranch }: Loop, host: Host): Tracker {
  return {
    async backlog() {
      return { issues: openIssues(repo, `&labels=${readyForAgent}`), issuesWithOpenPullRequest: issuesWithOpenPullRequest(repo), pushedBranches: pushedBranches(repo) };
    },

    async linkedIssues(numbers) {
      return numbers.flatMap((number) => linkedIssue(repo, number));
    },

    async pushBranch(branch) {
      host.gitWithGitHub("push", repoUrl(repo), `refs/heads/${branch}:refs/heads/${branch}`);
    },

    async openPullRequest({ branch, title, body, label }) {
      return gh("pr", "create", "-R", repo, "--base", baseBranch, "--head", branch, "--title", title, "--body", body, "--label", label).trim();
    },

    async mergePullRequest(pullRequest, closes) {
      const mergeable = await waitWhile("UNKNOWN", () => gh("pr", "view", pullRequest, "--json", "mergeable", "--jq", ".mergeable"));
      if (mergeable === "CONFLICTING") return "conflict";
      check(mergeable === "MERGEABLE", `GitHub reports ${pullRequest} as ${mergeable}, not merged`);
      gh("pr", "merge", pullRequest, "--merge");
      const state = await waitWhile("OPEN", () => gh("issue", "view", String(closes), "-R", repo, "--json", "state", "--jq", ".state"));
      check(state !== "OPEN", `${pullRequest} is merged but #${closes} is still open`);
      return "merged";
    },

    async comment(issueOrPullRequest, body) {
      gh("issue", "comment", String(issueOrPullRequest), "-R", repo, "--body", body);
    },

    async relabel(issueOrPullRequest, { remove, add }) {
      gh("issue", "edit", String(issueOrPullRequest), "-R", repo, "--remove-label", remove, ...(add ? ["--add-label", add] : []));
    },
  };
}
