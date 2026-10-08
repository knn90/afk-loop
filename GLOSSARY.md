# AFK Loop

The Sandcastle loop that takes `ready-for-agent` issues, has agents implement, review and test them in a Sandbox, and hands back a PR, or merges it under Auto-merge; then takes a handed-back PR's review comments and revises it.

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

**Revision**:
An Implementer pass on an open loop PR, driven by its open review comments.
_Avoid_: rework, follow-up

**Revision PR**:
An open loop PR labelled `ready-for-agent`. The same PR before and after its Revision; no new PR is opened.
_Avoid_: follow-up PR

**Implementer**:
The Sandbox agent that writes the tests and code for one Eligible issue, and that judges and works the comments of a Revision.

**Reviewer**:
The Sandbox agent that reviews the Implementer's branch against the issue and coding standards, and fixes what it finds.

**Drafter**:
The Sandbox agent that drafts the PR body for a branch the Reviewer left green. It changes no file.

**Open finding**:
A finding the Reviewer left unfixed that the maintainer must decide. An unfixed finding the issue itself settles, or that belongs to a later issue, is not open.
_Avoid_: declined finding

**Platform**:
One folder of the project with its own coding standards and Test run steps, handed to the loop by the project's `.sandcastle/loop.config.ts`. It is present unless it names a `presentWhen` file the branch lacks. For example iOS for `ios/` (Xcode), Android for `android/` (Gradle, present once `android/gradlew` is).
_Avoid_: target, stack

**Test run**:
The checks the loop executes in the issue's Sandbox, judged by exit code: the steps of each present Platform whose folder the branch changes against the base branch. A branch changing no Platform's folder has no Test run.
_Avoid_: Host test run, CI, build

**Auto-merge**:
The Host merging a green PR in a run started with `--auto-merge`, then picking the next Eligible issue. Green: no open finding, a passed Test run on the reviewed commit, and a clean merge into `main`.
_Avoid_: auto-approve, squash

**Preflight**:
The check at the start of `run` and `smoke`, beside the env and Tart checks, of what the loop requires of the repo: files on `origin/<baseBranch>` and labels on GitHub. It stops with one list of everything missing, before any Sandbox opens or Attempt is spent.

**Attempt**:
One agent run followed by its Test run.

**Attempt budget**:
The 3 failed Attempts an issue may spend, shared by Implementer and Reviewer. Each Revision gets its own 3. Uncommitted changes in the Sandbox after an agent run count as a failure. The Implementer's green Attempt and a Reviewer run with no new commits spend none.
_Avoid_: retries, max tries

**Handoff**:
Returning an issue, or a Revision PR, to the maintainer as `ready-for-human` when the Attempt budget runs out; for a Revision PR, and for a green PR under Auto-merge, also when `main` no longer merges cleanly. Under Auto-merge a Handoff ends the run.
_Avoid_: failure, abort

**Leftover**:
A local worktree and branch, or a Sandbox, from an interrupted run that was never pushed; discarded, and the issue redone.
