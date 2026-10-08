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
npx --prefix .sandcastle afk-loop run [--cap 5] [--auto-merge]
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
npx --prefix .sandcastle afk-loop run [--cap 5] [--auto-merge]
```

Works Revision PRs, then Eligible issues, one at a time, up to the cap. An Eligible issue: a fresh Sandbox (a Tart VM cloned from `<name>-base`, holding a copy of the repo), an Opus Implementer in it on `issue/<n>-<slug>`, then a Test run the loop executes in the same Sandbox. Failures go back to the Implementer. Once green, an Opus Reviewer in the same Sandbox runs the code-review skill against the issue and the coding standards (as on the base branch), then reviews its design with the codebase-design skill, commits its fixes, and the loop re-tests; failures go back to the Reviewer, which then fixes only those. Both agents share the Attempt budget. The reviewed, green branch is pushed as a `ready-for-human` PR listing the findings the Reviewer left unfixed, each with its reason.

The Sandbox has no GitHub access, so the Host pastes into each agent's prompt every issue the issue body names (title, body, the maintainer's comments), except those under its Parent and Blocked by headings; the limits are in `loop/linked-issues.ts`.

The Test run and the Reviewer's standards follow what the branch changes against the base branch: each present platform whose folder it changes has its `steps` run, in the config's order, and its `standards` given to the Reviewer. A branch changing no platform's folder has no Test run and no standards. What a Test run is: `GLOSSARY.md`; the commands: each platform's `steps` in the project's `loop.config.ts`.

The Implementer has no diff to route on yet, so its prompt names every platform's standards file, to follow by folder.

- A Reviewer with no new commits skips the re-test: that commit is already green.
- The PR body: `Closes #n.`, then the Reviewer's draft, then the Host's own lines: who worked it, the unfixed findings, what the Test run verified.
  - The Reviewer drafts it with the `mattpocock-skills:pr` skill; the draft is the last `<pr-body>` block of its last run's reply.
  - With no draft the Host's lines stand alone.
  - The Host turns a closing keyword in the draft (`Fixes #n`) into `Refs #n`.
- A branch touching build configuration (package manifests, project files, build scripts) is tested and pushed like any other: none of it runs on the Host.
- After every agent run the Host fetches the Sandbox's commits as a git bundle onto the local branch, subject and hash unchanged. Uncommitted changes left in the Sandbox are a failed Attempt.
- The Sandbox is deleted when the issue's run ends; one left by an interrupted run is deleted at the next loop start.
- Handoff: the issue moves from `ready-for-agent` to `ready-for-human` and gets a comment, then the loop moves on.
  - Attempt budget spent: the branch is pushed as a `[#n] - Handoff: …` PR that `Refs` the issue and holds the last Attempt's filtered feedback; if it ran out in review, the last green commit too. With no commits, or if the PR fails, the feedback goes in the comment.
  - To requeue: close the PR, delete the branch on GitHub and locally (with its worktree), relabel the issue `ready-for-agent`.
- Logs, on the Host: the project's `.sandcastle/logs/` (Implementer and Reviewer runs, raw Test run output in `<branch>-test-run.log`).

### Auto-merge

With `--auto-merge` the loop merges each green PR it opens in that run, on any platform, and then picks the next Eligible issue; a chain of issues that block each other runs through without the maintainer. Off by default.

- Green (defined in `GLOSSARY.md`) is read from the last `<open-findings>N</open-findings>` in the Reviewer's review reply, the Test run on the reviewed commit, and GitHub's `mergeable`.
- A PR with an open finding, or with no Test run (the branch changes no platform's folder), is handed back as without the flag.
- A PR that conflicts with the base branch is a Handoff: it stays open as `ready-for-human`, the issue moves to `ready-for-human` with a comment, and the run stops.
- A spent Attempt budget is the usual Handoff, and the run stops too. So does a Revision's Handoff.
- Revised PRs are handed back as before.
- The merge fails as an error, stopping the run, when GitHub can't say the PR is mergeable, refuses the merge, or leaves the issue open after it.

### Revision

To have the loop revise one of its PRs: comment on the PR (inline threads, conversation comments or a review body), then move the PR's label from `ready-for-human` to `ready-for-agent`. The issue's label stays as it is.

- Picked: open PRs labelled `ready-for-agent` on an `issue/<n>-*` branch of this repo whose issue is open, oldest first, before any Eligible issue.
- Fed to the Implementer: every unresolved inline thread with its replies, plus conversation comments and review bodies newer than the last Revision's summary. Only authors with write access count. None found: a note on the PR, back to `ready-for-human`.
- Before the session the Host sets the local branch to the pushed one and merges the base branch into it. A local branch with unpushed work is left alone and the PR skipped with a comment.
- The Implementer, alone (no Reviewer), gives every comment a verdict before editing: `fixed`, `declined` (stale, against the issue or standards, or outside the PR's change) or `question`. Valid comments are fixed with the tdd skill. Then the Test run; failures go back to it, on a fresh Attempt budget.
- Green: the Host pushes, replies in each thread, resolves the `fixed` ones, and posts one summary comment that answers the unthreaded comments and names the log. No commits and nothing merged: replies only, no Test run.
- Handoff (Attempt budget, or a conflict with the base branch): nothing is pushed or answered, the local branch goes back to the pushed one, and one comment says why.
- Either way the PR ends on `ready-for-human`. Relabel it `ready-for-agent` for another round.
- Logs: `.sandcastle/logs/issue-<n>-revision-<k>-implementer-<run>.log`.

## Tests

```bash
npm ci
npm test
npm run typecheck
```

`loop/folder.test.ts` holds this repo to its rule: no project named, nothing imported from outside, and a copy of the repo alone typechecks next to another project's config.
