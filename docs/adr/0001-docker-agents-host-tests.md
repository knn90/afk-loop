# 1. Docker agents, Mac host tests

Status: superseded by [ADR 2](0002-tart-vm-sandbox.md); was accepted

## Context

The project the loop was first built for builds and tests only on macOS: Core imports SwiftData, SwiftUI and UIKit, and every test needs an iOS Simulator. Every Sandcastle provider (Docker, Podman, Vercel, Daytona) is Linux. An agent that can't compile writes Swift blind; an agent on the host is unsandboxed.

## Decision

Hybrid. The Implementer and Reviewer run in Docker on an `issue/<n>-<slug>` worktree under `.sandcastle/worktrees/`. The Mac host runs the Host test run on that worktree and feeds failures back to the agent.

## Options considered

- **`noSandbox()` on the host**: agents compile and test themselves, but get full access to the Mac, its keychain and GitHub credentials. Rejected.
- **Docker only**: isolated, but no Swift toolchain can build an iOS app on Linux, so there's no feedback loop. Rejected.
- **Custom macOS VM provider (e.g. Tart)**: isolated with real builds, but means writing and maintaining a provider, plus macOS VM images and licensing. Deferred.
- **Hybrid**: chosen. Isolation for the agent, real builds on the host, at the cost of running agent-written code on the host.

## Risks and mitigations

- **Agent code runs unsandboxed in `xcodebuild`.** Build plugins, package manifests and scripts execute at build time. Diff guard: a branch touching `Package.swift`, `*.pbxproj`, `.swiftpm/`, scripts or `.sandcastle/` skips the Host test run and goes to Handoff.
- **`.git` escape** ([sandcastle#1010](https://github.com/mattpocock/sandcastle/issues/1010)): the container mounts the host `.git` read-write, so an agent could plant hooks or config the host then runs. Every host git call passes `-c core.hooksPath=/dev/null -c core.fsmonitor=false`; the orchestrator snapshots `.git/config` and `.git/hooks` before each agent run and stops the loop (no more host git or `xcodebuild`) if they changed.
- **GitHub credentials.** The container gets only `CLAUDE_CODE_OAUTH_TOKEN`. The host holds `GH_TOKEN`, a fine-grained PAT scoped to the project's repo, and does every push, PR, label and comment. Sandcastle injects only the keys listed in `.sandcastle/.env`, so `GH_TOKEN` lives in a separate `host.env`.

## Consequences

- The agent can't run tests, so its prompt says so and each Attempt costs a Host test run.
- One issue at a time. Parallel runs, and the simulator contention they'd cause on the host, are a follow-up.
