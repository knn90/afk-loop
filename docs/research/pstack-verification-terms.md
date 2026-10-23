# pstack verification terms and roles

Research for #22 (part of #20). Facts only; picking afk-loop's terms is the maintainer's call.

## Sources

- Primary: [backnotprop/pstack](https://github.com/backnotprop/pstack) `main` @ `e44668c` (2026-10-20), a mirror of `cursor/plugins/pstack`. The local clone `~/Workspace/Learn/pstack/pstack/` matches it (blob SHAs of both verification SKILL.md files checked). Paths below are relative to the repo root, as `path:line`.
- Secondary: the maintainer's own learning notes in `~/Workspace/Learn/pstack/` (`GAPS.md`, `lessons/0008*`, `lessons/0009*`, `drafts/verify-dailyquest/`). These are not pstack. They're cited only where they introduce terms.

## Summary

- pstack has **no single outcome set** like PASS/FAIL/INCONCLUSIVE. Each context has its own (see the Outcome rows).
- pstack has **no "Done when" section name**. It says **finish condition**, "what done means" and "done means...". Playbooks also say **exit condition**, **predicate** and **done predicate**.
- **Journey** shows up once in passing (`create-verification-skill`). The map's units are the **feature**, **feature file**, **sub-feature** and **entry point**.
- The agent that judges is never the author: "the agent that judges a change is never the one that wrote it". pstack calls that agent a **verifier** or "fresh agent". It names no single role.

## Terms

### The step that drives the app, and the skill behind it

| Term | Definition (pstack's words, condensed) | Source |
|---|---|---|
| Verification skill (`verify-<app>`) | Project-local skill that is a "scripted way to drive the real app and prove behavior: launch it, exercise a feature the way a user would, and capture evidence". Written to `<skills>/verify-<app>/`. | `skills/create-verification-skill/SKILL.md:9`, `:25` |
| Control skill | Name used in the playbooks for the skill that exercises the real surface, e.g. `control-ui` and `control-cli` from `cursor-team-kit`. | `skills/poteto-mode/playbooks/shipping.md:7`; `autopilot-full.md:8` |
| Control adapter | Benny's name for the user-configured skill that starts and drives the target app. Must have 7 capabilities, or the run fails closed. | `automations/benny/skills/reproduce-and-fix-issues/references/control-adapter.md:3-9`; `.../SKILL.md:126-142` |
| Launch | Section: "the exact command that starts the app for verification, and how to tell it's ready". Must reach a usable state from an empty data dir. "Ready means usable." | `skills/create-verification-skill/SKILL.md:27` |
| Drive | Section: "the harness recipe with real selectors/commands from this repo". Prefers stable handles over coordinates. Also used as a verb and a count ("drive ONE mapped feature", "each drive"). | `skills/create-verification-skill/SKILL.md:29`, `:40`; `maintain-verification-skill/SKILL.md:33` |
| Harness | The tool that drives the app (Playwright, PTY/tmux, CDP, HTTP). Also used in "harness gap". | `skills/create-verification-skill/SKILL.md:17`, `:29` |
| Cleanup | Section: tear down only what the run started. "Cleanup removes instances and scratch state, never the evidence." | `skills/create-verification-skill/SKILL.md:31` |
| Helpers | Scripts the skill ships, executable, with the invocation shown in the skill body. | `skills/create-verification-skill/SKILL.md:32` |
| Live pass | In maintenance, the coordinator drives every feature live, "required even when source looks clean". | `skills/maintain-verification-skill/SKILL.md:33` |
| Verify on the matching surface / same surface | Feature and Bug-fix playbook step. "'Inconclusive' or wrong-surface is not a pass." | `skills/poteto-mode/playbooks/feature.md:13`; `bug-fix.md:10` |
| Prove It Works | Principle: "verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles'". | `skills/principle-prove-it-works/SKILL.md:3-9` |
| Proxy | Indirect check (mtimes, self-reports, cached screenshots, "it compiles") that the principle rejects. | `skills/principle-prove-it-works/SKILL.md:9-15` |

### The agent running it

| Term | Definition | Source |
|---|---|---|
| Verifier / fresh agent | "One fresh agent per PR proves the behavior live, and the agent that judges a change is never the one that wrote it." The guide says "a swarm of verifiers". Autopilot uses "independent verifiers". | `docs/guide/06-verify-and-ship.md:73`, `:128`; `skills/poteto-mode/playbooks/autopilot-full.md:8` |
| (Shipping) one subagent per PR | "Safe means a verdict from an agent that did not write the code. CI green is not a verdict, and an approving bot review is not a verdict." | `skills/poteto-mode/playbooks/shipping.md:7` |
| Owner | In Autopilot, the agent that builds a PR end to end, i.e. the author. "No owner merges on its own verdict." | `skills/poteto-mode/playbooks/autopilot-full.md:3`; `docs/guide/07-overnight.md:74` |
| Root | In Autopilot, the agent that swarm-verifies each round and owns the verdicts ("You own the verdicts, never the PRs"). | `skills/poteto-mode/playbooks/autopilot-full.md:3`, `:8` |
| Coordinator | In maintenance, the agent that "owns all driving". In Benny, the agent that owns status and the fix. | `skills/maintain-verification-skill/SKILL.md:33`; `automations/benny/skills/reproduce-and-fix-issues/SKILL.md:107`, `:256` |
| Source readers / children | Read-only subagents, one per feature file: "Children never drive the app and never edit files." | `skills/maintain-verification-skill/SKILL.md:29` |
| Worker | Swarm subagent with its own slice and check. | `skills/swarm/SKILL.md:36` |
| Lane | One independent check inside a verify round: gates, live lane, review lanes, regression lane against trunk. "The live lane is the floor, and a verdict without it is not clean." | `skills/poteto-mode/playbooks/autopilot-full.md:8` |
| Media reviewer | Benny's read-only reviewer that answers one question: "does the evidence visibly show the discriminating broken state?" | `automations/benny/skills/reproduce-and-fix-issues/SKILL.md:194` |

### Outcome values (each context has its own)

| Context | Values | Source |
|---|---|---|
| Verdict on a PR (Shipping) | `PASS`, `PASS+NOTES`, `FAIL`. Posted on the PR. `PASS` and `PASS+NOTES` both pass. | `skills/poteto-mode/playbooks/shipping.md:7-8` |
| Verdict on a round (Autopilot) | "clean verdict", or not clean. A defect filed as a note is still a finding. | `skills/poteto-mode/playbooks/autopilot-full.md:8-9`; `autopilot-stack.md:9` |
| Swarm worker report | `PASS`, `ISSUES`, `BLOCKED`, "with evidence". | `skills/swarm/SKILL.md:36`; `docs/guide/04-design.md:59` |
| Maintenance pass | `clean`, `changed`, `blocked`. | `skills/maintain-verification-skill/SKILL.md:11-17` |
| Unreachable feature (maintenance) | `verified-unreachable`, valid only with the concrete prerequisite and the route tried. | `skills/maintain-verification-skill/SKILL.md:33` |
| Verify existing fix (Benny) | `Confirmed`, `Insufficient fix`, `Inconclusive` ("baseline does not reproduce, the patched app cannot run, or the evidence does not show the discriminating state"). | `automations/benny/skills/reproduce-and-fix-issues/references/verify-existing-fix.md:61-89` |
| Repro statuses (Benny) | Reproducing, Could not reproduce, Blocked, Reproduced, Verifying existing fix, Attempting bounded fix, Draft pull request opened, Fix did not land. | `automations/benny/skills/reproduce-and-fix-issues/SKILL.md:111-120`, `:183` |
| Benchmark verdict | faster, slower, no measurable difference, inconclusive. | `docs/guide/06-verify-and-ship.md:49` |
| Free-form reply | "If a check couldn't run, a good reply says 'inconclusive'." | `docs/guide/06-verify-and-ship.md:17` |
| Verdict (general) | The judged result itself. It is pinned to the patch: record the verdict head SHA, base SHA and `git patch-id`, and re-check them before landing ("patch-id rule"). | `skills/poteto-mode/playbooks/shipping.md:9` |

### Evidence

| Term | Definition | Source |
|---|---|---|
| Evidence | Section: "what to capture for a proof and where it goes", plus the proof standards: real user path, action and resulting state, side effects, mocks only at production boundaries. | `skills/create-verification-skill/SKILL.md:30` |
| Proof | Used interchangeably with evidence: "proof artifacts survive the teardown", "Proof and skip reporting". | `skills/create-verification-skill/SKILL.md:31`; `.../references/feature-map-example/README.md:23-31` |
| Artifact | A proof you can inspect: "the failing test and then the passing one, a before-and-after video, the trace, the screenshot". | `docs/guide/06-verify-and-ship.md:27`; `skills/principle-prove-it-works/SKILL.md:20` |
| Receipts / repro receipt | Proof attached to a report. Asked for "where no test can show the defect". | `skills/poteto-mode/playbooks/autopilot-full.md:8` |
| Discriminating state | The final state that tells correct from broken behavior. Evidence must show it. | `automations/benny/skills/reproduce-and-fix-issues/SKILL.md:153`, `:171-181` |
| Translated evidence | An attempt in a different environment that tests the same behavior. It is not to be called an exact repro. | `automations/benny/skills/reproduce-and-fix-issues/references/control-adapter.md:151` |
| Evidence pointer | Column in the `/show-me-your-work` decision log (`decisions.tsv`). | `docs/guide/07-overnight.md:60` |

### The issue's acceptance section ("Done when")

| Term | Definition | Source |
|---|---|---|
| Finish condition | "Put what done means in the first prompt." It gives the agent checks to run, "not a mood to satisfy". | `docs/guide/06-verify-and-ship.md:9-17`; `docs/guide/07-overnight.md:3`, `:20` |
| "done means..." | The phrase used in prompts. It "turns the goal into checks every iteration can run". | `docs/guide/07-overnight.md:24`, `:32` |
| Exit condition / predicate | Autonomous run: "State the exit condition as a checkable predicate before the first iteration." | `skills/poteto-mode/playbooks/autonomous-run.md:3-5` |
| Done predicate | Swarm Phase A, step 1. | `skills/swarm/SKILL.md:22` |
| Success criteria | Part of the delegate's scope in the Feature playbook. | `skills/poteto-mode/playbooks/feature.md:12` |
| Handoff | The prompt that hands a task to an unattended agent: "goal, the finish condition, permissions, and an escape hatch". | `docs/guide/07-overnight.md:20` |

### Feature map and journeys

| Term | Definition | Source |
|---|---|---|
| Feature map | `<skills>/verify-<app>/features/`: a README index plus one file per user-facing feature. "The map is the repo's maintained verification source." | `skills/create-verification-skill/SKILL.md:34-36` |
| Feature file | One feature, with exactly four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`. | `skills/create-verification-skill/SKILL.md:36`; `.../references/feature-map-example/README.md:33-42` |
| Sub-feature (ID) | Short ID, one line per behavior, e.g. `create-save`. | `.../references/feature-map-example/create-note.md:5-10` |
| Entry point | Each user route into a feature. "Do not report a skipped entry point as verified through a different path." | `.../references/feature-map-example/README.md:30-31`, `:38`; `skills/create-verification-skill/SKILL.md:36` |
| Journey | Used once, undefined: "If the seed data lacks a precondition that a journey needs, the journey reports a failure ... Never weaken the journey to make it pass." | `skills/create-verification-skill/SKILL.md:36` |
| Recipe | A feature file used as driving steps: "use the matching feature file as the recipe". Also a source reader's "one live-verification recipe". | `.../references/feature-map-example/README.md:3`; `skills/maintain-verification-skill/SKILL.md:29` |
| Baseline preconditions / Preconditions | The map-wide start state, and each recipe's `Preconditions:` list. | `.../references/feature-map-example/README.md:5-12`, `:39` |
| Driving conventions | Map-wide driving rules. | `.../references/feature-map-example/README.md:14-21` |
| Gotchas | Traps that can waste or invalidate a run, and where an unmet seed precondition is recorded. | `.../references/feature-map-example/README.md:40`; `skills/create-verification-skill/SKILL.md:36` |
| Doc drift / harness gap / product gap | Maintenance triage: map wrong = doc drift (fix the map). App works but can't be driven = harness gap (fix it). App broken = product gap (report it, never fix it in the map). | `skills/maintain-verification-skill/SKILL.md:21`, `:35` |
| Index hygiene / Source wave / Reconcile / Triage | Steps of the maintenance pass. | `skills/maintain-verification-skill/SKILL.md:27-37` |

### Doctor

| Term | Definition | Source |
|---|---|---|
| Doctor | "One read-only check that answers 'is this instance worth driving?'": process up, right build, port owned, auth valid. Run first whenever anything looks off. | `skills/create-verification-skill/SKILL.md:28` |
| Doctor invariant | Doctor before the first drive, on each fresh session, after any failed drive. Where doctor can't see the failure, reset or relaunch. A doctor failure caused by skill drift is drift. | `skills/maintain-verification-skill/SKILL.md:33` |

### Landing (verification-adjacent)

| Term | Definition | Source |
|---|---|---|
| Contiguous verified run | PRs from the bottom up to the first one without a passing verdict. Only this run lands. | `skills/poteto-mode/playbooks/shipping.md:8` |
| Ceiling | The first PR that breaks the chain. | `skills/poteto-mode/playbooks/shipping.md:8`, `:15` |
| Round | Autopilot: verification starting at a code-ready head SHA and at each push that changes the patch. Fresh swarm, fresh verdict. | `skills/poteto-mode/playbooks/autopilot-full.md:8` |

### Maintainer's draft and notes (not pstack)

| Term | Use | Source |
|---|---|---|
| `dq doctor` | The DailyQuest Doctor: read-only JSON `booted`, `installed_matches_build`, `app_running`, `tree_readable`, `on_today`. | `~/Workspace/Learn/pstack/drafts/verify-dailyquest/SKILL.md:16-18` |
| "verification map" | The draft's title for its feature map. | `drafts/verify-dailyquest/features/README.md:1` |
| Verdict PASS / PASS+NOTES / FAIL, "Done when" | GAPS.md G2 and G3. "Done when" is the maintainer's proposed name, not pstack's. | `~/Workspace/Learn/pstack/GAPS.md:9-10` |
| Journey | Used as "full journey" (G13) and "check-off journey" (G15). | `GAPS.md:20`, `:22` |
| Meat proxy, Control Glass | From poteto's talk, via secondary summaries. Control Glass was her first verification skill at Cursor. | `lessons/0008-why-verification-skills.html` (lines 25, 29 of the text) |

## Clashes with afk-loop's language

- **Verified**: afk-loop's PR line `Verified: the Test run passed on the reviewed commit (...)` (`loop/platforms.ts:56`), `Platform.verified` (`loop/platforms.ts:17`, ADR 0004) and README "the Verified line of its PRs" (`README.md:55`). pstack's "verified" means proved by a non-author verdict (`verified-unreachable`, "contiguous verified run", Benny "Mark operations status as verified"). The word is not in GLOSSARY.md, but the code and README use it.
- **Handoff**: in afk-loop it means returning an issue as `ready-for-human` (`GLOSSARY.md:73-75`). In pstack it means the prompt that starts an unattended run (`docs/guide/07-overnight.md:20`).
- **Reviewer**: afk-loop's read-only code reviewer agent (`GLOSSARY.md:38-39`). pstack uses "reviewer" generically (`/interrogate` reviewers, media reviewer, Comment Sicko). In pstack the judge of behavior is the verifier, never a "reviewer".
- **Finding / Fixable finding / Open finding**: afk-loop's Reviewer categories (`GLOSSARY.md:41-46`). Autopilot uses "proven finding" and "A defect that a lane filed as a note is a finding" (`autopilot-full.md:8`). `PASS+NOTES` notes would sit next to afk-loop's findings.
- **Round / Fix round**: afk-loop's Implementer's one round on Fixable findings (`GLOSSARY.md:48-49`). In pstack a round is a verification round at a head SHA (`autopilot-full.md:8`).
- **Evidence**: the afk-loop Reviewer prompt already has a PR-draft rule, "Evidence: quote only output of commands you run in this Sandbox" (`loop/reviewer-prompt.ts:59`). pstack's Evidence is a verification skill section and an artifact store.
- **Blocked**: afk-loop uses "Blocked by" headings and "open blocker" (`GLOSSARY.md:20`, `:28`). pstack uses `blocked` / `BLOCKED` as an outcome (maintenance, swarm, Benny).
- **Cleanup vs Leftover**: afk-loop's Leftover (`GLOSSARY.md:77-78`) is discarded, and the Sandbox is deleted at the end of the run. pstack's Cleanup must never delete evidence (`create-verification-skill/SKILL.md:31`). GAPS G8 notes the same tension.
- **Platform / Step vs Launch / Drive**: afk-loop's Test run "steps" are project code per Platform (`GLOSSARY.md:55-61`, ADR 0004). pstack's Launch/Drive/Doctor are sections of a skill, not Platform steps.
- **Attempt**: afk-loop's "One agent run followed by its Test run" (`GLOSSARY.md:66-67`). Benny says "a second attempt" and "translated attempt" for repro tries (`reproduce-and-fix-issues/SKILL.md:177`, `control-adapter.md:151`).
- **Preflight**: afk-loop's check of repo files and labels (`GLOSSARY.md:63-64`). Benny says "source preflight" (`verify-existing-fix.md:69`), with a different meaning.
- No clash: Doctor, feature map, feature file, entry point, journey, verdict, verifier, finish condition, inconclusive, PASS/FAIL. None of these is in afk-loop's GLOSSARY, README or `loop/` code.
