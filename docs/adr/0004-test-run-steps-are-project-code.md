# 4. A Test run's steps are project code behind `Platform`

Status: accepted.

## Context

The loop must test a branch without knowing the project. The first loop held one project's workspace, schemes, package folders and Gradle tasks. A second project has a different layout.

## Decision

`Platform` is the seam. The project's `loop.config.ts` hands the loop `Platform` objects: `name`, `folder`, `standards`, `agentBuildHint`, `verified`, `steps(sandbox)`, and optionally `afterFailure` and `presentWhen`.

- **Steps are code**: `steps(sandbox)` runs the project's own commands in the Sandbox. The loop knows no workspace, scheme, package folder or build task.
- **The loop routes**: a platform has a Test run when the branch changes its `folder` (and, if set, the `presentWhen` file is on the branch). The prompts' build line and the Reviewer's standards are composed from the same objects.
- **The loop ships only what steps share**: the failure formats (`xcodeFailures`, `gradleFailures`) and `timedOutExitCode`.

## Rejected

- **Values only, with loop-owned runners**: the config names a workspace and schemes, and the loop runs them. This puts one project's layout into the loop.
- **Loop-shipped platform factories**: deferred until a second project shows what two platforms of one kind share. Adding them later changes no existing config.
