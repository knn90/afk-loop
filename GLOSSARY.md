# AFK Loop

The Sandcastle loop that takes `ready-for-agent` issues, has agents implement, review and test them in a Sandbox, and hands back a PR, never merging it.

## Language

**Host**:
The machine the loop script runs on. It holds the GitHub token and does every push, PR, label and comment.
_Avoid_: orchestrator, the Mac

**Sandbox**:
The macOS VM an issue's agents and Test runs execute in. One per issue, with no GitHub token.
_Avoid_: container, VM image

**Eligible issue**:
An open `ready-for-agent` issue with no open blocker, no linked open PR and no pushed `issue/<n>-*` branch.
_Avoid_: candidate, ticket, task

**Implementer**:
The Sandbox agent that writes the tests and code for one Eligible issue, and fixes the Reviewer's Fixable findings.

**Reviewer**:
The Sandbox agent that reviews the Implementer's green branch against the issue and coding standards, sorts its findings into Fixable and Open, and drafts the PR body. It changes no file.

**Fixable finding**:
A finding the Reviewer is sure is valid, and that the Implementer can fix inside this diff with no decision from the maintainer.

**Open finding**:
A finding the maintainer must decide, posted on the PR as a review comment. Any finding the Reviewer doubts is one, and so are a Fixable finding left unfixed, a finding in the Fix round's commits and a real problem outside the issue's work. A point the issue itself settles is not a finding.
_Avoid_: declined finding

**Fix round**:
The Implementer's one round on the Reviewer's Fixable findings, after its branch is green. Its work up to that green branch is its first round.

**Wrap-up**:
The Reviewer's second run, after a Fix round: it reviews the Fix round's commits, checks each Fixable finding, gives the final Open findings and drafts the PR body.
_Avoid_: second review, re-review

**Platform**:
One folder of the project with its own coding standards and Test run steps, handed to the loop by the project's `.sandcastle/loop.config.ts`. It is present unless it names a `presentWhen` file the branch lacks. For example iOS for `ios/` (Xcode), Android for `android/` (Gradle, present once `android/gradlew` is).
_Avoid_: target, stack

**Test run**:
The checks the loop executes in the issue's Sandbox, judged by exit code: the steps of each present Platform whose folder the branch changes against the base branch. A branch changing no Platform's folder has no Test run.
_Avoid_: Host test run, CI, build

**Preflight**:
The check at the start of `run` and `smoke`, beside the env and Tart checks, of what the loop requires of the repo: files on `origin/<baseBranch>` and labels on GitHub. It stops with one list of everything missing, before any Sandbox opens or Attempt is spent.

**Attempt**:
One agent run followed by its Test run.

**Attempt budget**:
The 3 failed Attempts an issue may spend, shared by the Implementer's first round and its Fix round. Uncommitted changes in the Sandbox after an Implementer run count as a failure. A green Attempt, a Fix round with no new commits and a Reviewer run spend none. Spent in the first round it is a Handoff; spent in the Fix round it is not, and the Fix round's fixes are dropped.
_Avoid_: retries, max tries

**Handoff**:
Returning an issue to the maintainer as `ready-for-human` when the Attempt budget runs out in the Implementer's first round or the Implementer makes no commits. The Fix round never ends in one. A Handoff does not end the run.
_Avoid_: failure, abort

**Leftover**:
A local worktree and branch, or a Sandbox, from an interrupted run that was never pushed; discarded, and the issue redone.
