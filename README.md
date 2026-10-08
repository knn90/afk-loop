# afk-loop

The AFK loop: it takes a repo's `ready-for-agent` issues, has agents implement, review and test them in a Sandbox (a Tart macOS VM), and hands back PRs. Vocabulary: [`GLOSSARY.md`](GLOSSARY.md). Decisions: [`docs/adr/`](docs/adr/).

This repo holds no project's details and imports nothing outside itself. A project reaches it through its entry module, [`index.ts`](index.ts), and its command, `afk-loop`.

## A project's `.sandcastle/`

The project keeps its own details in its repo's `.sandcastle/`:

- `package.json` and its lockfile, depending on `afk-loop`.
- `loop.config.ts`: its default export is `defineLoop({ name, repo, image, smokeIssue, platforms })`, imported from `afk-loop`.
- `.env` and `host.env`, with their `.example` files.
- Gitignored: `node_modules/`, `logs/`, `worktrees/`, `runs/`.

The config names the project, its repo, the base image, the Smoke issue and the platforms. A platform names its folder, coding standards, the build line the agents' prompts give for it, the Verified line of its PRs, and its Test run steps, written as project code; the loop routes, tests and prompts over whatever platforms the config hands it, and ships only the failure formats (`xcodeFailures`, `gradleFailures`) and `timedOutExitCode` for those steps to use. Every VM name comes from `name` (`<name>-base`, `<name>-issue-<n>`, `<name>-smoke`), and Leftover deletion touches only that project's issue VMs. `model` and `baseBranch` (`main`) are loop defaults the config may override.

## The command

`afk-loop run|smoke|build-image` finds `.sandcastle/loop.config.ts` from the git root of the folder it runs in, so it works from the repo root or any subfolder:

```bash
npx --prefix .sandcastle afk-loop run [--cap 5]
npx --prefix .sandcastle afk-loop smoke
npx --prefix .sandcastle afk-loop build-image
```

From a subfolder, give `--prefix` the repo's `.sandcastle/`: `npx --prefix "$(git rev-parse --show-toplevel)/.sandcastle" afk-loop smoke`.

## Setup

Needs Node 22+, an Apple Silicon Mac and [Tart](https://tart.run) (`brew install cirruslabs/cli/tart`, or the release tarball with `tart` on `PATH` or at `~/.local/bin/tart`).

```bash
npm --prefix .sandcastle ci
cp .sandcastle/.env.example .sandcastle/.env
cp .sandcastle/host.env.example .sandcastle/host.env
npx --prefix .sandcastle afk-loop build-image
```

Fill both env files from the comments in each. `.env` is the Sandbox's env (Sandcastle injects every key in it); `host.env` stays on the Host.

`afk-loop build-image` clones the config's image into the base VM `<name>-base`, sizes it, upgrades Claude Code, installs the skills plugin at the tag `loop/skills-plugin.ts` pins and checks it has the skills the prompts name (`tdd`, `code-review`, `codebase-design`, `pr`), runs the config's provision steps, runs one Test run over every present platform to warm the caches, and shuts the VM down. It prints the pinned plugin version, and fails naming any required skill that is missing. Rebuild after changing `loop/build-image.ts`, the plugin tag or the config's image, or updating the image's tools. A plugin bump is a loop commit: change the tag in `loop/skills-plugin.ts`.

A platform with `presentWhen` is present once that file is on the branch: an Android platform with `presentWhen: "android/gradlew"` has no Test run, warm-up included, until `android/gradlew` exists. Rebuild when it first lands on the base branch.

## What a repo needs

The loop requires these of the repo it works. Before `run` and `smoke` start anything, after the env and Tart checks, a preflight (`loop/preflight.ts`) checks them all and stops with one list of everything missing, each with its fix. No Sandbox is opened and no Attempt is spent.

- On `origin/<baseBranch>`, not the working tree (the Sandbox and the Reviewer read the base branch's copy):
  - `GLOSSARY.md` at the root. `GLOSSARY-MAP.md` is optional; the prompts follow it when it exists.
  - `docs/agents/git-conventions.md`.
  - Each platform's `standards` file, at the path `loop.config.ts` gives it.
- On GitHub: the labels `ready-for-agent` and `ready-for-human`. When one is missing the list gives its `gh label create` command; the loop creates nothing in the repo.

The loop also imposes its branch `issue/<n>-<slug>`, commit and PR title `[#n] - Summary`, and `Closes #n.`; the repo's `git-conventions.md` must agree. That is stated here, not checked.

## Smoke run

```bash
npx --prefix .sandcastle afk-loop smoke
```

Passes when the Host reads an issue with `GH_TOKEN`, the Sandbox has no GitHub token, an Opus agent in the Sandbox reads the repo and lists its mattpocock-skills, a commit made in the Sandbox reaches the Host branch with the same subject and hash, and the Test run over every present platform is green.

## AFK loop

```bash
npx --prefix .sandcastle afk-loop run [--cap 5]
```

Works Eligible issues, one at a time, up to the cap. It never merges a PR: merging is the maintainer's, so an issue with an open blocker is worked in a later run, once the blocker's PR is merged. A run stops early only on an error. An Eligible issue: a fresh Sandbox (a Tart VM cloned from `<name>-base`, holding a copy of the repo), an Opus Implementer in it on `issue/<n>-<slug>`, then a Test run the loop executes in the same Sandbox. Failures go back to the Implementer. Once green, an Opus Reviewer in the same Sandbox runs the code-review skill against the issue and the coding standards (as on the base branch), then reviews its design with the codebase-design skill. It changes no file: it sorts each finding into Fixable or Open. The Implementer fixes the Fixable findings in one Fix round, the Test run decides again, and a second Reviewer run wraps up. A branch with no Fixable finding takes one Reviewer run. The reviewed, green branch is pushed as a `ready-for-human` PR, and the Open findings are posted on it as one PR review.

The Sandbox has no GitHub access, so the Host pastes into each agent's prompt every issue the issue body names (title, body, the maintainer's comments), except those under its Parent and Blocked by headings; the limits are in `loop/linked-issues.ts`.

The Test run and the Reviewer's standards follow what the branch changes against the base branch: each present platform whose folder it changes has its `steps` run, in the config's order, and its `standards` given to the Reviewer. A branch changing no platform's folder has no Test run and no standards. What a Test run is: `GLOSSARY.md`; the commands: each platform's `steps` in the project's `loop.config.ts`.

The Implementer has no diff to route on yet, so its prompt names every platform's standards file, to follow by folder.

- The Reviewer is read-only. After each Reviewer run the Host puts the branch, on the Host and in the Sandbox, back at the commit the Test run passed, whatever the run left behind. No Test run follows a Reviewer run, and the pushed commit is always a tested one.
- Sorting a finding. It is Open when any of these holds, and Fixable otherwise:
  - fixing it changes behaviour the issue asked for, or the issue does not say which way to go;
  - there is more than one reasonable fix, with different results for the user or for the design;
  - the fix reaches outside this diff: another module, or a later issue's work;
  - the Reviewer is not sure the finding is valid.
- The Reviewer's first run returns the Fixable findings as text for the Implementer, in the last `<fixable-findings>` block of its reply, the Open findings, and, with no Fixable finding, the PR body.
  - Both findings blocks are always in its reply, an empty one for none. A reply that lacks one, or whose `<open-findings>` block has text and no `<finding>`, is an error: the run stops with no PR opened, after the branch is put back at the tested commit.
- The Fix round: one per issue, only when the first run returned a Fixable finding.
  - The Implementer runs with only the Fixable findings, in a `<fixable-findings>` block, and fixes each test-first.
  - It may leave a finding it judges wrong. It lists each one it left and why in the last `<findings-left>` block of its reply; the Host passes the wrap-up the latest block that lists one, of all the Fix round's runs.
  - New commits get a Test run. A failure goes back to the Implementer as Host feedback, after the Fixable findings, and spends the Attempt budget, shared with the first round. Uncommitted changes are a failed Attempt.
  - No new commits: no Test run.
  - Attempt budget spent in the Fix round is not a Handoff. The Host puts the branch back at the first round's green commit, dropping the Fix round's commits; the wrap-up still runs, on that commit, and the PR opens as usual.
- The wrap-up: the second Reviewer run, only after a Fix round. It gets the first run's Fixable and Open findings and the findings the Implementer left.
  - It reviews the Fix round's commits only (the first round's green commit to the head) with the code-review skill, against the same coding standards, with no design review. Every finding there is an Open finding.
  - It returns the final Open findings: the first run's, restated against the final diff, each Fixable finding that was not fixed, with the Implementer's reason where it gave one, and each finding in the Fix round's commits.
  - After a Fix round that spent the Attempt budget it reviews nothing, and every Fixable finding becomes an Open finding. If its reply then gives no Open finding, the Host posts the Fixable findings' text itself, as one Open finding in the review's body.
  - A reply with no `<open-findings>` block, or one with text and no `<finding>`, is not an empty one: the Host posts the first run's Open findings itself.
  - It drafts the PR body.
  - What it finds never starts a second Fix round.
- The PR body: `Closes #n.`, then the Reviewer's draft, then the Host's own lines: who worked it, how many Open findings were posted (or that there were none), that the Fix round failed its Test run and its fixes are not included (when it did), what the Test run verified.
  - The Reviewer drafts it with the `mattpocock-skills:pr` skill; the draft is the last `<pr-body>` block of its last run's reply.
  - With no draft the Host's lines stand alone.
  - The Host turns a closing keyword in the draft (`Fixes #n`) into `Refs #n`.
- Open findings: after opening the PR the Host posts them as one PR review, submitted as a comment. No Open finding: no review.
  - A finding with a path and a line on the new side of the diff is an inline comment on that line; one without a line is in the review's body, after its path when it has one.
  - If GitHub rejects the review, the Host posts it again with every finding in the body, each after its path and line.
  - Each comment starts with the loop's marker and a line naming the AFK loop's Reviewer, so it is told from the maintainer's own and stays out of the issues pasted into prompts.
  - The Reviewer returns them in the last `<open-findings>` block of its reply, one `<finding>` each; the Host posts and counts only those of its last run. A point the issue's own text settles is not reported; a real problem outside the issue's work is.
- A branch touching build configuration (package manifests, project files, build scripts) is tested and pushed like any other: none of it runs on the Host.
- After every agent run the Host fetches the Sandbox's commits as a git bundle onto the local branch, subject and hash unchanged. Uncommitted changes left in the Sandbox are a failed Attempt.
- The Sandbox is deleted when the issue's run ends; one left by an interrupted run is deleted at the next loop start.
- Handoff: the issue moves from `ready-for-agent` to `ready-for-human` and gets one comment, then the loop moves on. Nothing is pushed and no PR is opened. What the session left, if anything, is on the Host: on the local branch, or uncommitted in its worktree. A worktree with no uncommitted change is removed, and with it a branch with no commits.
  - Two causes, both in the Implementer's first round: the Attempt budget is spent, or an Implementer run ends with a clean worktree and no commits. The second is a Handoff at once, with no further run.
  - The comment: why, the last Attempt's filtered feedback with the raw log's path (for no commits, the Implementer's last reply with its log's path), the branch's name, the steps to requeue.
  - To requeue: remove the local branch and its worktree, if they are still there, then relabel the issue `ready-for-agent`.
- Logs, on the Host: the project's `.sandcastle/logs/` (Implementer and Reviewer runs, raw Test run output in `<branch>-test-run.log`).

## Tests

```bash
npm ci
npm test
npm run typecheck
```

`loop/folder.test.ts` holds this repo to its rule: no project named, nothing imported from outside, and a copy of the repo alone typechecks next to another project's config.
