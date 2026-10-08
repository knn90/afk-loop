import { issueNumberOf, type Issue, type LinkedIssue, type RevisionPullRequest, type Tracker } from "./afk-loop.js";
import { check, gh, lines, repoUrl, type Host } from "./host.js";
import type { Loop } from "./loop-config.js";
import { readyForAgent } from "./loop-rules.js";
import { hasWriteAccess, isLoopComment, openReviewComments, revisionNumber, type AuthoredComment } from "./review-comments.js";

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

function graphql<Data>(query: string, variables: Record<string, string | number>): Data {
  const fields = Object.entries(variables).flatMap(([key, value]) => [typeof value === "number" ? "-F" : "-f", `${key}=${value}`]);
  return JSON.parse(gh("api", "graphql", "-f", `query=${query}`, ...fields)).data;
}

const revisionPullRequestsQuery = `query($owner: String!, $name: String!, $label: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, labels: [$label], first: 50, orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes { number headRefName isCrossRepository comments(last: 100) { nodes { authorAssociation body } } }
    }
  }
}`;

const authored = "author { login } authorAssociation body";

const reviewCommentsQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes { id isResolved path line comments(first: 50) { nodes { ${authored} diffHunk } } } }
      comments(last: 100) { nodes { ${authored} at: createdAt } }
      reviews(last: 100) { nodes { ${authored} at: submittedAt } }
    }
  }
}`;

interface Nodes<Node> {
  nodes: Node[];
}

interface RevisionPullRequestsData {
  repository: { pullRequests: Nodes<{ number: number; headRefName: string; isCrossRepository: boolean; comments: Nodes<{ authorAssociation: string; body: string }> }> };
}

interface ReviewCommentsData {
  repository: {
    pullRequest: {
      reviewThreads: Nodes<{
        id: string;
        isResolved: boolean;
        path: string;
        line: number | null;
        comments: Nodes<AuthoredComment & { diffHunk: string }>;
      }>;
      comments: Nodes<AuthoredComment>;
      reviews: Nodes<AuthoredComment>;
    };
  };
}

function ownerAndName(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/") as [string, string];
  return { owner, name };
}

function revisionPullRequests(repo: string): RevisionPullRequest[] {
  const data = graphql<RevisionPullRequestsData>(revisionPullRequestsQuery, { ...ownerAndName(repo), label: readyForAgent });
  const ownBranch = data.repository.pullRequests.nodes.filter((pullRequest) => !pullRequest.isCrossRepository);
  const issues = ownBranch.length > 0 ? openIssues(repo) : [];
  return ownBranch.flatMap((pullRequest) => {
    const issueNumber = issueNumberOf(pullRequest.headRefName);
    const issue = issues.find((issue) => issue.number === issueNumber);
    if (!issue) return [];
    return [{ number: pullRequest.number, branch: pullRequest.headRefName, issue, revision: revisionNumber(pullRequest.comments.nodes) }];
  });
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

    async revisionPullRequests() {
      return revisionPullRequests(repo);
    },

    async linkedIssues(numbers) {
      return numbers.flatMap((number) => linkedIssue(repo, number));
    },

    async reviewComments(pullRequest) {
      const { reviewThreads, comments, reviews } = graphql<ReviewCommentsData>(reviewCommentsQuery, { ...ownerAndName(repo), number: pullRequest }).repository.pullRequest;
      return openReviewComments({
        threads: reviewThreads.nodes.map((thread) => ({ ...thread, diffHunk: thread.comments.nodes[0]?.diffHunk ?? "", comments: thread.comments.nodes })),
        comments: comments.nodes,
        reviews: reviews.nodes,
      });
    },

    async replyInThread(thread, body) {
      graphql(
        `mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id } } }`,
        { thread, body },
      );
    },

    async resolveThread(thread) {
      graphql(`mutation($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { thread { id } } }`, { thread });
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
