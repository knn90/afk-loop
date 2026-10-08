# 2. Tart macOS VM as the Sandbox

Status: accepted. Supersedes [ADR 1](0001-docker-agents-host-tests.md).

## Context

Under ADR 1 the agents ran in Docker (Linux) and the Mac built and tested every Attempt. The agent wrote Swift blind, agent-written code ran unsandboxed in `xcodebuild` on the Mac, and the Diff guard handed off every branch touching build configuration. ADR 1 deferred a macOS VM provider as too costly to maintain.

## Decision

The Sandbox is a Tart macOS VM on the Host machine. The agent, its builds and the Test run all happen inside it. The Host runs the loop script and talks to GitHub, nothing else.

- **Provider**: Sandcastle stays; the VM plugs in as a custom isolated provider. The repo is copied in as a git bundle; the Host `.git` is never shared.
- **One VM per issue**: cloned from the project's base VM `<name>-base`, kept running for the issue, deleted at close. A VM left by an interrupted run is deleted at the next loop start.
- **Base VM**: Cirrus Labs `macos-tahoe-xcode:26.4` plus `afk-loop build-image`: Claude Code upgraded, the skills plugin, one pre-warm Test run.
- **Test run**: the loop executes `xcodebuild` in the issue's VM after each agent run and reads the exit code. A green result is the loop's reading, not the agent's claim.
- **Commits return as a git bundle** the Host fetches, so subject and hash are unchanged. Sandcastle's own return (`git format-patch` + `git am`) still runs after each agent run, but strips a leading `[#n]` and rewrites hashes; the Host then resets the branch to the VM's HEAD from the bundle.
- **Credentials**: the VM gets only `CLAUDE_CODE_OAUTH_TOKEN`. The Host holds `GH_TOKEN` and does every push, PR, label and comment.

## Spike

Host: Apple Silicon, 10 cores, 16 GB, macOS 26.4, Xcode 26.4. VM: 6 CPU, 8 GB, Tart 2.32.1.

| Check | Result |
|---|---|
| Boot to ready | 22–34 s |
| Clone + boot + repo copy | 32–41 s |
| Test run, cold | VM 251 s, Host 131 s (1.92×; limit 2×) |
| Test run, warm, same VM | 113 s |
| Agent through the provider | ran `xcodebuild` itself, committed |

## Options considered

- **Keep Docker (ADR 1)**: no new tooling, but blind agents, agent code on the Mac, and a Handoff for every build-configuration change. Rejected.
- **Shared folder (bind mount) into the VM**: no copy in or out, but shares the Host `.git` again. Kept only as the spike's fallback; not needed.
- **A second fresh VM for the Test run**: removes the tamper risk below, at about a minute and 8 GB more per Attempt. Rejected for now.
- **Patch Sandcastle's patch return (`-k`)**: keeps subjects, still rewrites hashes, and forks a dependency. Rejected for the bundle.
- **A spare Mac as the Sandbox**: out of scope.

## Risks and mitigations

- **Agent and Test run share one VM.** The agent could tamper with the toolchain or the simulator so a broken branch tests green. Accepted: every PR still gets the maintainer's review; a second VM is the fix if it ever bites.
- **Open network.** The VM has default NAT internet access. Accepted; it holds no GitHub token.
- **Fetching agent-made git objects on the Host.** The Host fetches the bundle with `fetch.fsckObjects` on and runs git with hooks off; it never builds or runs the code.
- **`tart stop` can lose recent guest writes.** The base VM is shut down from inside the guest.
- **Host load.** The VM takes 6 of 10 cores and 8 of 16 GB while an issue runs.

## Consequences

- The agent builds and tests before it finishes; its prompt says so, and that the Test run decides.
- The Diff guard and the `.git` fingerprint check lose their reason and are gone: a branch touching build configuration or loop tooling gets a Test run and a PR like any other.
- Docker, its image and its checks are gone. The base VM is 86 GB on disk and must be rebuilt after an Xcode update.
- Tart is free for personal use; check the licence before organisational use.
- Still one issue at a time: Apple allows two macOS VMs per host, and 16 GB allows one.
