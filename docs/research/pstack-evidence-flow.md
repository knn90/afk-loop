# How does pstack move verification evidence through its loop?

Research on whether pstack solved afk-loop's problem: evidence (screenshots, video, logs, verdict) made inside a Tart VM Sandbox has to reach the verifier, the PR, the human and the Handoff, while ADR 0002 keeps `GH_TOKEN` on the Host. Researched 2026-10-25.

Source: pstack mirror `backnotprop/pstack` @ `18b6c36` (current `origin/main`, syncs `cursor/plugins/pstack` @ `e73df47`, 0.15.32). The local clone was checked out at `1f0f9c3` (0.15.25). Every file cited below either did not change between the two, or was re-read at `18b6c36`. Citations `[n]` point to file:line at `18b6c36` (see Sources). pstack is prose skills plus a few TS helpers (`orch`, `watch-pr`, `check-plan`). It has no runner code, so "how it works" means "what the skills tell the agent to do". **[fact]** = stated in pstack source; **[inference]** = my reading; **[absent]** = searched for and not found. The maintainer notes (`~/Workspace/Learn/pstack/GAPS.md`, lessons 0008/0009, `drafts/verify-dailyquest/`) were used only as leads.

## Verdict

- **pstack has no transport for evidence.** It never says how a file gets from the machine that made it to anywhere else. There is no copy-out, scp, tar, upload or attach code. Searches for `sandbox`, `container`, `docker`, `tart`, `scp`, `rsync`, `tar`, `base64`, `chunk`, `upload`, `download` and `transfer` found nothing that moves evidence. **[absent]** Bytes move through the harness: the Cursor cloud agent, Cursor's built-in PR tool, or Cursor's Slack actions. [9][12][16][19]
- **Evidence is made where the agent runs.** By default that is a Cursor cloud agent, so each verifier lane is "its own cloud VM". Simulators and local-only auth are the exception and run on the user's machine. [5][6][7] pstack never runs a verifier in a sandbox that it controls, and it has no Host/VM split like afk-loop. **[absent]**
- **The verifier is also the poster.** In Shipping, the cloud-agent verifier itself "posts `PASS`, `PASS+NOTES`, or `FAIL` on that PR". [9] The owner agent (also a cloud agent) opens the PR and attaches the videos and screenshots. [10][11] So the forge credential is in the same VM that runs the untested code. pstack names no token and no scope. It uses whatever `gh` or the built-in PR tool has. **[inference]**
- **Storage is by convention only:** `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` on each lane VM, `<media path>/<pr-id>-review.mp4` for the human, `/tmp/benny-artifacts` (24 h) in Benny, and an artifact location named by each project's `verify-<app>` skill. Evidence must stay out of the repo. [7][8][14][15]
- **What crosses agents is a pointer, not bytes.** Swarm lanes "return the paths with the report". Ledger and decision rows hold `evidence` as a pointer. Cloud agents "cannot read the local store", so briefs inline or point at repo paths. [6][7][17][20][22] pstack never says how the coordinator opens a path that exists only on a lane's VM. **[absent]**
- **The trust rules are strong, and portable:** no PASS without a live run on the real surface; only a non-author's verdict counts; a verdict is bound to head SHA and patch-id; a read-only media reviewer must confirm that the evidence shows the broken state; cleanup must never delete evidence; "work that exists only on one VM when that VM dies was never done". [1][2][6][9][13][14]
- **For afk-loop:** copy the trust rules, not the plumbing. pstack's "verifier posts on the PR" breaks ADR 0002. afk-loop has to solve the large-file copy-out itself. The fix is scp or chunked `dd` from the Host before `deleteVm`, then Host `gh --attach`.

## Findings

### 1. Where evidence is produced

- **[fact]** `create-verification-skill` makes each project write its own `verify-<app>` skill with Launch, Doctor, Drive, Evidence and Cleanup sections. "Observe: what evidence can be captured? Screenshots, terminal transcripts, response bodies, logs, exit codes, DB state." [1] It never says where the app runs. It says only that a proof made in "a stand-in for the real target (a container in place of a fresh VM ...)" must list the steps that the stand-in did and the target will not do. [1]
- **[fact]** Workers and verifiers are "Always `environment: \"cloud\"` unless the task needs this machine: `control-ui` or `control-cli` runtime verification ... Simulators and local IDE state. Auth that exists only here." [6] Swarm spawns lanes with `environment: "cloud"`. [5] In multi-phase plans, "Each live lane runs on its own cloud VM at the PR head", and the review video is recorded "on a lane VM". [7]
- **[fact]** In other harnesses (Claude Code included), `environment: "cloud"` maps to a local worktree: "Elsewhere, run that agent locally in its own worktree". [4][3] Outside Cursor, evidence is therefore made on the user's own machine, with no isolation boundary.
- **[fact]** Benny (the Slack issue automation) needs a control adapter with "Screenshot" ("Capture the current app state to a requested path") and "Recording" (start and stop around the full repro path). [14]
- Note: the drive tools (`control-ui`, `control-cli`) live in Cursor's `cursor-team-kit`, not in pstack. [4] They were not read.

### 2. Where it is stored

- **[fact]** Swarm lanes: "Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report." Human review media: `<media path>/<pr-id>-review-<slug>.png` and `<media path>/<pr-id>-review.mp4`. [7]
- **[fact]** Benny config: `artifact_directory: "/tmp/benny-artifacts"`, `artifact_retention_hours: 24`. [15] The adapter must "Keep captures outside the repository". [14] The repro skill says "Keep captures, recordings, logs, and tokens out of source control." [12]
- **[fact]** The project verify skill names its own location. Cleanup "removes instances and scratch state, never the evidence: proof artifacts survive the teardown, in a location the skill names." [1] The worked example writes `artifacts/<feature>/*.png` and `*.aria.txt`. [2]
- **[fact]** The decision trail is `decisions.tsv` (or `.audit/<task-slug>.tsv`). It is local and uncommitted by default, and its `evidence` column is "a link or path ... Never a paragraph". [20] Orchestrate's `ledger.tsv` has the header `pr sha verdict evidence verifier ts`, in the coordinator's agent store. [6][22]

### 3. How it gets from producer to consumers

- **Verifier and judge.** **[fact]** Swarm: each brief says what to report, and "Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence". The parent drops a result that lacks the SHAs and the method, and "A gap does not count as a pass." [5] What comes back is the agent's report text with file paths. Orchestrate says "Cloud agents cannot read the local store, so their briefs inline what they need or point at repo paths." [6] **[absent]** pstack has no step that moves a lane's `/tmp/swarm-...png` to the coordinator.
- **Externalize before the VM dies.** **[fact]** "A unit is not done until its output is externalized the moment it lands ... A worker pushes its branch, a verifier writes its ledger row, receipts land in the store. Work that exists only on one VM when that VM dies was never done." [6] Autopilot-full repeats it: "Assume the VM dies. Soon after starting, push and start a decision trail in the root agent's store." [10] Branches go out through git. The ledger row is text written by `orch`. pstack never says how a binary receipt (a video) "lands in the store". **[absent]**
- **PR.** **[fact]** "After the sections, attach videos or screenshots when they prove a claim. ... 'CLEAN' verdicts go in a linked artifact, not the body." When the run has a built-in PR tool, use it rather than a forge CLI. [11] **[absent]** pstack does not say how the attaching is done (no `gh --attach`, no upload endpoint).
- **Human reviewer.** **[fact]** For an interaction change: "Copy lane <n> screenshots into `<media path>/...`", "Record a 30 to 60 second video ... on a lane VM", then "Post the screenshots and the video in chat. Stop at merge-ready." [7] The `/ketchup-video` skill renders slides from "the screenshots, recordings, diffs, and data the work produced" into an mp4 and embeds it in the reply. [21]
- **Slack (Benny).** **[fact]** "Post detailed evidence only in the operations thread". "Attach evidence only when the configured Slack action keeps it inside the same source thread and the organization's retention policy allows it." [12] The draft PR "Include[s] the repro steps, root cause, test result, before and after evidence". [12] It is made through `pull_request_action: "configured-draft-pull-request-action"`. [15]
- **Handoff and resume.** **[fact]** The pause and pickup playbooks write a resume note to a file (for example `/tmp/<slug>-resume.md`). Cloud work is picked up again "by PR and branch rather than agent id". [6][23] Evidence moves across a handoff only as pointers in the trail and in the PR.

### 4. Who uploads or attaches, with what credentials

- **[fact]** Shipping: "One verifier per PR, each a Cursor cloud agent, runs the change ... and posts `PASS`, `PASS+NOTES`, or `FAIL` on that PR. Only a verdict from an agent that did not write the code counts". [9] The verifier writes to GitHub itself.
- **[fact]** Autopilot-full: "Each owner is a Cursor cloud agent that builds, opens its PR ... and merges". [10] Autopilot-stack: "every link carrying its verifier verdict in the PR body or a comment." [24]
- **[fact]** Forge: "GitHub CLI (`gh`) is the default", or Origin, or the run's built-in PR tool. [9][11] **[absent]** pstack names no GitHub token, scope or credential rule anywhere (searched for `GH_TOKEN`, `token`, `credential`). The only credential rules in pstack are about Slack.
- **[fact]** Benny Slack rules: "The coordinator is the only Slack poster." "Never give a child a Slack token". "A fix-phase code worker may edit only when its environment provably excludes Slack credentials and every Slack write action." "Never expose the token to a worker." [12][13] For GitHub, though, "The coordinator owns every Slack post, the final diff review, commits, and the pull request". [12] The coordinator is itself a Cursor automation agent in the same environment that runs the app. **[inference]**
- **[inference]** So pstack's credential split is coordinator versus worker inside the agent layer. It is not trusted Host versus untrusted VM. The GitHub credential is wherever the cloud agent's `gh` or Cursor's GitHub integration puts it.

### 5. Does pstack run its verifier inside a sandbox?

- **[fact]** It runs verifiers as Cursor cloud agents, each on its own VM. [5][6][7][9] That VM is the agent's whole workspace. The agent, the app under test, the evidence and the forge access all live there. Cursor provides it. pstack does not.
- **[absent]** There is no verifier-inside-a-sandbox-driven-from-outside pattern. pstack has no sandbox or VM code (`git grep -iw sandbox` finds only `reflect/references/tooling-reviewer.md:27`, "sandbox surprises"), no `tart`, `docker` or `container` runner, and no file-transfer step. Evidence never has to cross a sandbox boundary in pstack, because the agent that made it is the one that posts it.
- **[fact]** In Claude Code, `environment: "cloud"` becomes `isolation: "worktree"`, and steps "that need the cloud agent itself, such as its dashboard status or its own machine" are skipped. [3] The Claude Code port therefore drops even the per-lane VM.

### 6. Trust rules attached to evidence

- **No PASS without a live run.** **[fact]** "Tests alone are not sufficient verification ... The live block is mandatory." [7] "The verdict is not clean without the live lane". [10] "A compile, unit test, code review, or plausible diff is not after evidence." [12] "Do not pretend a screenshot, unit test, state mutation, or source reading is a UI repro." [12] Prove It Works lists "agent self-reports" and "cached screenshots" as proxies, not proof. [18]
- **The verdict comes from a non-author.** **[fact]** "Only a verdict from an agent that did not write the code counts". "Green CI and an approving bot review are not verdicts". [9] "A worker may self-report. A verifier overrides it on the same key." Run the verifier on a different model family from the worker. [6]
- **The verdict is bound to the code.** **[fact]** Ledger rows are keyed by PR plus head SHA. "A new head SHA voids the row". [6] Shipping re-checks `git patch-id` at the verdict SHA before landing. [9]
- **Someone reviews the evidence.** **[fact]** "Have a read-only media reviewer answer one question: does the evidence visibly show the discriminating broken state? If the answer is no or uncertain, the repro is not confirmed." [12] The symptom must appear twice through real UI. "State inspection may confirm an observation. It must not inject or force the symptom." [12] The verifier for an existing fix must see the symptom twice on baseline and gone twice on the patched build. "If the symptom does not appear twice on the baseline, there is no baseline." [13]
- **Evidence content rules.** **[fact]** A screenshot "must show enough app chrome to prove that the correct app is under test". A recording "must show the discriminating final state". The adapter returns path, time and an app marker with each capture, and keeps "secrets out of logs and artifacts". [14] UI proof is "an ARIA snapshot and a screenshot with the app identity visible". Each artifact records the feature ID and the entry point. [2]
- **Cleanup must keep evidence.** **[fact]** "After cleanup, confirm the evidence still exists at the named location — a cleanup that eats the proof fails this step." [1] In the maintenance pass: "evidence captured so far survives every cleanup, checked at its named location, not assumed". [19]
- **Trail audit.** **[fact]** At the end of the run, check that "each row's evidence resolves and shows what the row claims". A reviewer on a different model family reads the trail and the transcript, and flags "Verification steps skipped or claimed without proof". [20]
- **Untrusted evidence content.** **[absent]** pstack never treats screenshots or logs from a lane as untrusted data (no type or size checks, no sanitizing). Benny treats "utility and debug bots" as "evidence sources", not as fix owners. [12]

## Implications for afk-loop

- **pstack did not solve the large-file copy-out problem. It avoids it.** Its verifier VM is also the poster, so nothing crosses a boundary. afk-loop's split (Sandbox drives, Host posts) is stricter than pstack, so the transport has to be afk-loop's own. Use scp (~0.2 s for 10 MB) as the primary path, with chunked `dd` over `tart exec` (~9 s) as the fallback. Do the copy before `deleteVm`. That is pstack's "work that exists only on one VM when that VM dies was never done" rule, made into a Host step. [6]
- **pstack's PR flow does not fit ADR 0002.** In Shipping the verifier posts the verdict on the PR from its own cloud VM [9], and owners attach media from the same machine [10][11]. That needs a forge credential in the VM that runs untested code. Keep afk-loop's rule. The Host attaches with `gh --attach`, after checking the type and size of the copied files, and writes the verdict comment. The Reviewer in the Sandbox writes a verdict file. It never posts.
- **Borrow these rules from pstack (they are independent of transport):**
  - The Reviewer (non-author) produces the verdict, `PASS` / `PASS+NOTES` / `FAIL`, keyed to the head SHA. The Host refuses to post a verdict for a SHA that differs from the tested commit. This is close to the Host's current reset to the tested commit. [6][9]
  - No `PASS` unless the evidence files the verify skill names exist on the Host after copy-out. A missing file means `BLOCKED`, never `PASS`. That is swarm's "a gap does not count as a pass" and the cleanup check, applied on the Host side. [1][5]
  - Each artifact carries a small manifest (feature ID, entry point, capture time, app marker). The Host can then check it without opening the video. [2][14]
  - Before `PASS`, a read-only media check answers "does this show the discriminating state?". [12]
  - The Handoff and the PR carry pointers (artifact URLs after upload, SHA, a decision-row pointer), not prose. [11][20]
- **Do not borrow:** "evidence is a path on the lane VM". [7] Once afk-loop deletes the VM, that path is a dangling pointer. Paths in the verdict must be guest paths that the Host maps to its own run dir (for example `.sandcastle/runs/<issue>/<attempt>/artifacts/`) after copy-out.
- **Extra afk-loop rule that pstack lacks:** treat the copied files as untrusted data (an allowlist of extensions, a size cap, never executed). GitHub's pwn-request split requires this, as covered in `docs/research/gh-token-in-sandbox.md`.

## Sources

pstack mirror `backnotprop/pstack` @ `18b6c36e6e201b110acc62472de987416ac4e23b`. Base URL `https://github.com/backnotprop/pstack/blob/18b6c36e6e201b110acc62472de987416ac4e23b/`.

1. `skills/create-verification-skill/SKILL.md` L17-18 (Observe), L30-31 (Evidence, Cleanup), L40 (prove, stand-in, evidence survives cleanup)
2. `skills/create-verification-skill/references/feature-map-example/README.md` L21-31 (proof rules); `search.md` L37, `create-note.md` L32 (artifact paths)
3. `docs/harness/claude-code.md` L23, L66 (`environment: "cloud"` → `isolation: "worktree"`)
4. `skills/poteto-mode/SKILL.md` L107 (cloud agent; elsewhere a local worktree), Harness section ("Tools pstack doesn't ship": `control-ui`/`control-cli` from `cursor-team-kit`)
5. `skills/swarm/SKILL.md` L27 (cloud spawn), L31 (other harnesses), L33 (`PASS`/`ISSUES`/`BLOCKED` with evidence), L39 ("A gap does not count as a pass")
6. `skills/poteto-mode/playbooks/orchestrate.md` L17 (worker/verifier placement; cloud agents cannot read the local store), L21-32 (store layout), L90 (ledger, SHA key, verifier overrides self-report), L92 (externalize; VM dies), pickup after restart (Liveness section)
7. `skills/poteto-mode/playbooks/multi-phase-plan.md` L13 (live block mandatory; review gate), L71 (lane cloud VM), L76 (`/tmp/swarm-<pr-id>/worker-<n>/<slug>.png`), L122-124 (media path, mp4, post in chat)
8. `skills/poteto-mode/playbooks/multi-phase-plan.md` L120-124 (review gate)
9. `skills/poteto-mode/playbooks/shipping.md` L5 (verifier cloud agent posts verdict on PR; non-author only), L7 (patch-id)
10. `skills/poteto-mode/playbooks/autopilot-full.md` L8 (owner is a cloud agent; opens PR, merges), L12 ("Assume the VM dies"), L14 (live lane required)
11. `skills/poteto-mode/playbooks/opening-a-pr.md` L22 (attach videos/screenshots; verdicts in linked artifact), L26 (built-in PR tool)
12. `automations/benny/skills/reproduce-and-fix-issues/SKILL.md` L18-30 (hard safety rules), L122 (bot token never to a worker), L142 (no fake repro), L185-198 (capture, media reviewer), L214 (attach in thread only), L244 (coordinator owns PR), L280 (compile is not after evidence), L284-294 (draft PR with evidence)
13. `automations/benny/skills/reproduce-and-fix-issues/references/verify-existing-fix.md` L47, L59, L61-89 (baseline/patched, outcomes)
14. `automations/benny/skills/reproduce-and-fix-issues/references/control-adapter.md` L85-109 (screenshot, recording), L127-139 (keep secrets out of artifacts; captures outside repo)
15. `automations/benny/templates/configuration.example.yaml` L23 (`pull_request_action`), L51-52 (`/tmp/benny-artifacts`, 24 h)
16. `automations/benny/FOR_AGENTS.md` L20-24, L30 (subagents get no Slack credentials)
17. `skills/poteto-mode/scripts/orch/store.ts` L18 (`LEDGER_HEADER = "pr\tsha\tverdict\tevidence\tverifier\tts"`)
18. `skills/principle-prove-it-works/SKILL.md` L9-11, L20-22
19. `skills/maintain-verification-skill/SKILL.md` L33 (invariant 2: evidence survives every cleanup)
20. `skills/show-me-your-work/SKILL.md` L13, L21 (evidence is a pointer), L46 (local by default), audit and cross-model review sections
21. `skills/ketchup-video/SKILL.md` (Slides, Render)
22. `docs/guide/07-overnight.md` L60 (decision trail), L116 ("Every stage hands over evidence")
23. `skills/poteto-mode/playbooks/pause-safely.md` L8 (resume note to `/tmp/<slug>-resume.md`)
24. `skills/poteto-mode/playbooks/autopilot-stack.md` (Deliver the chain: verdict in PR body or comment)
