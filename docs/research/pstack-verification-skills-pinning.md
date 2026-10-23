# Pinning only pstack's two verification skills, and what they lack for the loop

Research for #28 (part of #20). Facts only; no decision. Terms research is on branch `research/pstack-verification-terms` (#22) and is not repeated here.

## Sources

- [backnotprop/pstack](https://github.com/backnotprop/pstack) `main` @ `e44668c` (2026-10-20), a harness-neutral mirror of `cursor/plugins/pstack`. Paths below are `path:line` in that commit. The two verification skills and `LICENSE` are identical in the local clone `~/Workspace/Learn/pstack/pstack` (@ `1f0f9c3`).
- [cursor/plugins](https://github.com/cursor/plugins) `main` @ `8b3326d`, the upstream with the Claude Code marketplace.
- [vercel-labs/skills](https://github.com/vercel-labs/skills) @ `a80e4c9` `docs/commands.md`, and a local run of `npx skills@1.7.4`.
- Claude Code skills docs: https://code.claude.com/docs/en/skills (read 2026-10-23).
- afk-loop `main` @ `3d1362e`.
- Secondary: maintainer's notes `~/Workspace/Learn/pstack/GAPS.md`, cited only where marked.

## Summary

- pstack is **MIT**, © 2026 Lauren Tan. Copying, modifying and redistributing are allowed if the copyright and permission notice go with every copy.
- The two skills have **no dependency** on `poteto-mode`, playbooks, principles or `setup-pstack`. The only link is that `create-verification-skill` points the user to `/maintain-verification-skill`. The mirror's README says to install the two together.
- Installing only these two skills at a commit **works today** with the `skills` CLI: `npx skills add https://github.com/backnotprop/pstack/tree/<sha>/skills/<name>`. Run locally, it installed the pinned commit's content and recorded the sha in `skills-lock.json`. It does not copy `LICENSE`.
- The Claude Code **plugin** route (afk-loop's mattpocock mechanism) installs the **whole** pstack plugin from `cursor/plugins`. That copy also differs from the mirror: it writes to `.cursor/skills/` and asks the agent to read an adapter doc.
- Both skills have `disable-model-invocation: true`, so an agent can't call them with the Skill tool. Only a human typing `/name` can run them. That fits "human on the Host, once per project". The `verify-<app>` skill they produce is a project skill committed in the repo, so it reaches the Sandbox with the repo clone. No Sandbox install of pstack is needed.
- The generated `verify-<app>` has no outcome values, no evidence path the Host knows, no link to an issue's acceptance criteria, no rule about who runs it, and no mapping from changed files to features. See the gap list.

## 1. License and terms

| Fact | Source |
|---|---|
| MIT License, "Copyright (c) 2026 Lauren Tan" | `LICENSE:1-3` |
| Grants rights "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies" | `LICENSE:5-10` |
| Condition: "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." | `LICENSE:12-13` |
| No warranty | `LICENSE:15-21` |
| Manifests say `"license": "MIT"` | `plugin.json:11`; `.cursor-plugin/plugin.json:11` |
| Upstream Claude Code tree ships the same MIT LICENSE | `cursor/plugins@8b3326d:harness/pstack/claude-code/LICENSE` |
| Author invites forks: "fork it. improve it. make it yours." | `README.md:62` |

No other terms on copying skills were found (README, MIRROR.md, manifests). A copy of the two skill folders that leaves out `LICENSE` does not meet the notice condition.

## 2. Install and pin mechanics

### What pstack is

| Fact | Source |
|---|---|
| The mirror is "a folder of plain Agent Skills (`skills/<name>/SKILL.md`)". Its documented install is `npx skills add backnotprop/pstack`, which lets you "select the skills you want" | `README.md:12-18` |
| The mirror has `plugin.json` (agent-plugins schema) and `.cursor-plugin/plugin.json`, but **no `.claude-plugin/`** dir and no `marketplace.json`. The GitHub contents API returns 404 for `.claude-plugin` | repo root @ `e44668c` |
| Upstream Claude Code install: `/plugin marketplace add cursor/plugins` then `/plugin install pstack@cursor-plugins` | `README.md:72-75` |
| The `cursor-plugins` marketplace's `pstack` entry is sourced from `./harness/pstack/claude-code`, a tree generated from `pstack/skills`, agents, docs and so on | `cursor/plugins@8b3326d:.claude-plugin/marketplace.json`; `harness/pstack/README.md` |
| That plugin's `.claude-plugin/plugin.json` (v0.15.30) has **no `skills` list**. Skills come from the `skills/` folder, so installing it installs every pstack skill and agent | `cursor/plugins@8b3326d:harness/pstack/claude-code/.claude-plugin/plugin.json` |

### Can one skill be installed alone?

- **skills CLI: yes.** `-s, --skill <skills...>` installs skills by name, and a "direct path to a skill in a repo" URL is a supported source. `-g` targets `~/<agent>/skills/`; the default is project `./<agent>/skills/`. `--copy` copies instead of symlinking (`vercel-labs/skills@a80e4c9:docs/commands.md:24-25, 64-72, 109-123`).
- **Tested 2026-10-23, skills 1.7.4**, empty dir, `npx skills add https://github.com/backnotprop/pstack/tree/<sha>/skills/<name> -a claude-code --copy -y`:
  - At old sha `1f0f9c3`, `setup-pstack` installed the **old** text, which differs from `main`. So the ref in the URL is honored.
  - `skills-lock.json` records `source`, `ref` (full sha), `skillPath` and `computedHash` for each skill.
  - `create-verification-skill` installed with its `references/feature-map-example/` (3 files) into `./.claude/skills/create-verification-skill/`.
  - `LICENSE` was **not** copied.
- **Claude Code plugin: whole plugin only.** A plugin is installed as a unit; the `cursor-plugins` pstack plugin has every skill. The mirror can't be added as a marketplace (no `.claude-plugin/marketplace.json`).
- **Manual sparse copy: possible.** A `git clone --filter=blob:none --sparse` plus `sparse-checkout set` at a sha is the pattern the mirror itself uses (`MIRROR.md:17-18`). Copy the two folders plus `LICENSE` into `.claude/skills/` or `~/.claude/skills/`. Claude Code finds skills at `~/.claude/skills/<name>/SKILL.md` (personal) and `.claude/skills/<name>/SKILL.md` (project) (Claude Code skills docs, "Where skills are discovered").

### Dependencies of the two skills

| Fact | Source |
|---|---|
| `create-verification-skill` links only to its own `references/feature-map-example/` and to `/maintain-verification-skill` | `skills/create-verification-skill/SKILL.md:36`, `:44` |
| `maintain-verification-skill` links only to `/create-verification-skill` | `skills/maintain-verification-skill/SKILL.md:9`, `:25` |
| Neither file mentions `poteto-mode`, `principle-*`, playbooks, `setup-pstack`, `pstack-models` or `cursor-team-kit` (grep of both skill dirs) | both dirs @ `e44668c` |
| The `control-notes` commands in the example are a made-up example harness for a "Notes" app, not a pstack tool | `references/feature-map-example/README.md:1-20` |
| Mirror README: "`create-verification-skill` → Also install `maintain-verification-skill`" | `README.md:35` |
| Mirror README: "Skills that spawn subagents point to the Subagents section of `poteto-mode` to pick each subagent's effort. Without `poteto-mode`, they use the default effort." `maintain` spawns one read-only subagent per feature file, but its text does not reference poteto-mode | `README.md:41`; `maintain-verification-skill/SKILL.md:29` |
| **Upstream Claude Code copy differs.** Both skills gain "In Claude Code, read the Claude Code adapter (`../../docs/harness/claude-code.md`) once per session", and they hard-code `.cursor/skills/verify-<app>/` where the mirror says `<skills>` = `.claude/skills/` in Claude Code | diff of mirror `e44668c` vs `cursor/plugins@8b3326d:harness/pstack/claude-code/skills/{create,maintain}-verification-skill/SKILL.md`; mirror `create-verification-skill/SKILL.md:9`, `:25`, `:36` |

### Fit with afk-loop's `skills-plugin.ts`

| Fact | Source |
|---|---|
| mattpocock is pinned as source `mattpocock/skills`, tag `v1.3.1`, installed with `claude plugin marketplace add mattpocock/skills#v1.3.1` then `claude plugin install mattpocock-skills@mattpocock` | `loop/skills-plugin.ts:5-10`, `:19-20` |
| Those commands run while the **Sandbox base image** is built (`build-image` provision), not on the Host | `loop/build-image.ts:17-21`, `:49` |
| The check reads the installed plugin's `.claude-plugin/plugin.json`, requires `version === "1.3.1"`, and looks for required skills in the manifest's **`skills` list** | `loop/skills-plugin.ts:22-31` |
| mattpocock's manifest lists skills explicitly (`"skills": ["./skills/engineering/..."]`) | `~/.claude/plugins/cache/mattpocock/mattpocock-skills/1.3.1/.claude-plugin/plugin.json` |
| Agents call skills as `mattpocock-skills:<name>` through the Skill tool | `loop/skills-plugin.ts:15-17`; `loop/implementer-prompt.ts:57`; `loop/reviewer-prompt.ts:80`, `:93` |

What follows from these facts for pstack:

- `skills-plugin.ts` can't take the mirror as is: there is no marketplace to add. The `cursor/plugins` route brings all of pstack, and its manifest has no `skills` list, so `checkSkillsPlugin`'s list check would report every skill missing.
- `create-verification-skill` and `maintain-verification-skill` have `disable-model-invocation: true` (`create-verification-skill/SKILL.md:4`; `maintain-verification-skill/SKILL.md:4`). Claude Code docs: "Claude can't invoke the skill on its own", and a Skill tool call is blocked. So a Sandbox agent prompted like the mattpocock skills couldn't run them.
- Per map #20, a human runs the generator once per project. The generator interviews and builds the **project repo** and proves the skill end to end (`create-verification-skill/SKILL.md:11-21`, `:38-40`), so it must be installed where that human runs Claude Code in the project: the Host (personal `~/.claude/skills/`, or the project's `.claude/skills/`).
- `maintain` ends in "one PR of proven corrections" (`maintain-verification-skill/SKILL.md:37`). The Sandbox "has no GitHub access" (`loop/prompt-parts.ts:88`, `:93`), so a Sandbox run couldn't open that PR.
- The generated skill goes to `<skills>/verify-<app>/` in the project (`create-verification-skill/SKILL.md:9`, `:25`). Its frontmatter is only `name` and `description`, with no `disable-model-invocation`, so agents can invoke it.
- The Sandbox gets the project as a git clone at `/Users/admin/workspace`, and agents run there (`loop/build-image.ts:32-40`; `loop/tart.ts:14`, `:170`). A committed `.claude/skills/verify-<app>/` is therefore in the Sandbox with no extra install. Any tools the skill drives with must come from the project's `image.provision` (`loop/build-image.ts:21`; `loop/loop-config.ts:7`).

## 3. Gaps: what a loop run needs that `verify-<app>` doesn't specify

Each row lists what the generator's output specifies and what afk-loop has today.

| Need | What `create-verification-skill` makes the generated skill say | afk-loop today |
|---|---|---|
| **Outcome values** | No outcome set for a drive. Sections are Launch, Doctor, Drive, Evidence, Cleanup and Helpers only (`create-verification-skill/SKILL.md:25-32`). A seed-data gap "reports a failure" (`:36`). Outcomes `clean`/`changed`/`blocked` are for maintenance passes, not behavior (`maintain-verification-skill/SKILL.md:11-17`). `verified-unreachable` needs the prerequisite and route attempted (`:33`). The example asks to "Report an unreachable path… Do not report a skipped entry point as verified" (`references/feature-map-example/README.md:30-31`). | The Host parses only tagged reply blocks (`fixable-findings`, `open-findings`, `pr-body`) (`loop/reviewer-prompt.ts:43-49`, `:98-100`). The Test run is judged by exit code (`GLOSSARY.md:59-60`). The PR line says `Verified: the Test run passed…` (`loop/platforms.ts:54-56`). There is no behavior-verdict block or value. |
| **Evidence location the Host can copy out** | "where it goes" and "proof artifacts survive the teardown, in a location the skill names". Any path is allowed (`create-verification-skill/SKILL.md:30-31`). The example uses repo-relative `artifacts/<feature>/…` (`references/feature-map-example/search.md:37`). The maintainer's draft uses `~/verify-dailyquest/runs/<run-id>/artifacts/` (secondary: `drafts/verify-dailyquest/SKILL.md:33`). | `copyFileOut` copies **one file** by `cat` (`loop/tart.ts:133-137`). It is used only for the git bundle (`loop/sandcastle-agents.ts:99`). There is no directory copy-out. `close` deletes the VM (`loop/tart.ts:174`). Secondary: a streamed 1.8 MB mp4 died with "Transport became inactive" in a spike (`GAPS.md` G8). PR media options: #23. |
| **The issue's acceptance section** | Nothing ties a drive to an issue. The generator works from the repo, and the map describes features from the user's point of view (`create-verification-skill/SKILL.md:11-19`, `:36`). pstack's own "finish condition" lives outside these two skills (see #22 research). | Issues are free text. The Implementer's done line says "every acceptance criterion in the issue" (`loop/implementer-prompt.ts:45`), but no section name is required and Preflight checks only files and labels (`GLOSSARY.md:63-64`). |
| **Non-author rule** | Not stated in either skill. Anyone, including the Implementer, could invoke the generated skill: it is model-invocable and committed in the repo. pstack's non-author rule is in other files (see #22). | The Reviewer is a separate agent that "change[s] no file and commit[s] nothing"; the Host resets the branch afterwards (`loop/reviewer-prompt.ts:51`; `README.md:39`). The Implementer and Reviewer share one Sandbox (ADR 0002 `docs/adr/0002-tart-vm-sandbox.md:42`). A drive creates simulators and artifacts outside the repo, which the "read-only" wording doesn't cover (secondary: `GAPS.md` G17). |
| **Running inside the Tart Sandbox** | The generator proves the skill once and, if it proved it in "a stand-in for the real target", must "list every setup step the stand-in did that the target will not" (`create-verification-skill/SKILL.md:38-40`). A human run on the Host Mac is such a stand-in for the Sandbox. Isolation must be stated (`:19`). Nothing about displays, VMs or simulators. | The VM boots with `--no-graphics --no-audio --no-clipboard` (`loop/tart.ts:68`). The Test run already runs `xcodebuild` in the VM (`docs/adr/0002-tart-vm-sandbox.md:16`). Per ADR 0001 every iOS test needs a Simulator (`docs/adr/0001-docker-agents-host-tests.md:7`). Secondary: a spike in a `dailyquest-base` clone ran launch, doctor, tap, record and screenshot headless (`GAPS.md` G13), but the full journey through afk-loop's own exec path is unproven. The harness choice is XCUITest (`GAPS.md` G15, decided 2026-10-23). |
| **Feature-map journeys per touched feature** | The map is seeded with the top 3-5 features. Each file has the H2s `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>` and `Gotchas`. "a proof that drives one convenient entry point is incomplete when the map lists others" (`create-verification-skill/SKILL.md:36`). The map keeps implementation details out ("Name only user paths…") (`references/feature-map-example/README.md:42`), so it holds **no source-path → feature mapping**. Only `maintain`'s source wave finds source entry points, and it doesn't store them (`maintain-verification-skill/SKILL.md:29`, `:39`). | A Platform is chosen by folder prefix of changed paths (`loop/platforms.ts:45-48`). `Platform` has no field naming a verify skill (`loop/platforms.ts:12-21`). |
| **Doctor result → loop action** | Doctor is a read-only "worth driving?" check (`create-verification-skill/SKILL.md:28`). Maintain's rules: doctor before the first drive, after failures, and drift retried once (`maintain-verification-skill/SKILL.md:33`). | No mapping to Attempt, Fix round or Handoff (map #20, "Not yet specified"). |
| **Cleanup vs Sandbox deletion** | "Cleanup removes instances and scratch state, never the evidence" (`create-verification-skill/SKILL.md:31`). | The whole Sandbox is deleted at close (`loop/tart.ts:174`), and Leftovers are discarded (`GLOSSARY.md:77-78`). |
| **Evidence wording in the PR** | The skill's Evidence section sets the proof standard (`create-verification-skill/SKILL.md:30`). | The Reviewer draft rule says "Evidence: quote only output of commands you run in this Sandbox. The Host adds what the Test run verified." (`loop/reviewer-prompt.ts:59`). |
