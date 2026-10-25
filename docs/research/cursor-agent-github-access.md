# How do Cursor cloud agents get GitHub access?

Research on whether Cursor Cloud Agents (formerly Background Agents), which pstack uses for its verifier and owner agents, put GitHub write access inside the VM that runs agent code. ADR 0002 avoids that setup. Researched 2026-10-25. Sources are first-party Cursor docs, Cursor's GitHub App metadata, and Cursor's own GitHub Security Advisories unless marked. **[fact]** = documented by Cursor or shown by GitHub's API for Cursor's app; **[inference]** = my reading of those facts; **[unverified]** = not confirmed at a primary source; **[community]** = Cursor forum post, with a Cursor staff reply.

Follows `docs/research/gh-token-in-sandbox.md`, which covered Claude Code web, Codex and Copilot but not Cursor.

## Verdict

- **Yes. Cursor puts a GitHub write credential inside the agent VM.** Cursor's own advisory says: "Cloud Agent sessions include GitHub App access tokens for repository operations." It says a stolen token "allows read/write access to the associated repository, including code, pull requests, checks, and workflows". [1] This is the setup ADR 0002 avoids.
- **The credential is a Cursor GitHub App installation token.** It is not a PAT. Docs: agents "reach your code through the Cursor GitHub or GitLab App, not through any single person's credentials". [2] Release notes: agents "refresh GitHub tokens during long runs instead of hitting expired tokens mid-run", which fits 1-hour installation tokens. [3] A forum error "Resource not accessible by integration" from `gh` inside the VM points the same way. [community] [12] Automations that "run as you" also open PRs as the user's GitHub account, so a user-to-server OAuth token is used for some writes. Where that token is held is not documented. [10]
- **The app is broad.** GitHub's API for app `cursor` lists `contents`, `pull_requests`, `issues`, `checks`, `actions`, `workflows`, `discussions` and `merge_queues`: write. `administration`, `members` and `packages`: read. [4] Repos are limited to those the admin selected at install, intersected with the triggering user's access. [2] **[unverified]** whether the in-VM token is down-scoped below the app's full set. No document mentions a branch limit beyond GitHub branch protection. With `workOnCurrentBranch: true` Cursor "pushes directly to that starting ref". [5]
- **Agent code can read it.** The VM auto-runs all terminal commands. [6] `gh` and GitHub API calls are made "from the agent's VM". [7] Self-hosted release notes contrast Cursor-hosted VMs, where agents may assume "a signed-in GitHub CLI". [3] The July 2026 advisory proves it in practice: web content got code execution in the VM and could reach "environment variables, and credentials available to that session", including the GitHub App token. [1] Git remotes are "scoped and proxied" [8]. That covers git traffic only; GitHub API traffic does not use the proxy. [7]
- **The agent pushes and opens PRs from inside the VM. It uploads artifacts from inside the VM too.** The run "pushes its branch and opens a draft pull request". [2] Artifacts go from the VM to `cloud-agent-artifacts.s3.us-east-1.amazonaws.com` (it must be allowlisted). They are embedded in PR descriptions as public, unguessable URLs. [6][9] Comments, review approvals and reviewer requests are posted as the `cursor` bot. [10] Whether the backend does any of these calls rather than the VM is not documented. **[unverified]**
- **Egress is open by default.** Modes are Allow all (default), Default + allowlist, and Allowlist only. Even "Allowlist only" keeps "Cursor's own services and source control management (SCM) providers" reachable. [6] The default list includes `github.com`. [11] So GitHub is always an outbound channel, the same gap that let Copilot's token leak (see prior research).
- **Cursor names the risk but answers it with containment, not token removal.** It warns that prompt injection could make the agent "exfiltrate code to an external host". [2][6] Its fixes are egress allowlists, Runtime Secrets (redacted from the transcript, but still env vars in the VM), `.cursorignore`, draft PRs, and signed commits. [2][6] It also warns that team follow-ups can steer an agent to "perform actions using the original creator's access tokens". [13]
- **Slack, Linear and GitHub-comment triggers don't change where the token lives.** They only change who starts the agent and what untrusted text it reads. Slack agents "read the entire thread for context". [14] GitHub `@cursor` comments need a "trusted repo commenter". [15] Automations add identity choices ("run as you" vs a service account) but not a different token location. [10]

## Findings

### 1. Credential type

- **[fact]** "Cloud Agents reach your code through the Cursor GitHub or GitLab App, not through any single person's credentials." An admin installs the app on chosen repos. Each user also "connects their own Git account". "A Cloud Agent can only reach repositories the triggering user could already reach." [2]
- **[fact]** "Grant read-write privileges to our GitHub app for repos you want to edit. We use this to clone the repo and make changes." [6]
- **[fact]** GHSA-whx2-4gvm-m3r3 (2026-07-06): "Cloud Agent sessions include GitHub App access tokens for repository operations." [1]
- **[fact]** Week of Oct 5, 2026: "Cloud Agents refresh GitHub tokens during long runs instead of hitting expired tokens mid-run." [3] **[inference]** Short-lived, refreshed tokens are consistent with GitHub App installation tokens (1 h expiry).
- **[fact]** Automations identity: "GitHub comments, review approvals, and reviewer requests run as `cursor`. Automations that run as you open pull requests as your GitHub account. Automations that run as the service account open pull requests as `cursor`." [10] **[inference]** "As your GitHub account" needs a user-to-server OAuth token from the user's connected account. **[unverified]** whether that user token ever enters the VM or stays in Cursor's backend.
- **[fact]** Commits are authored as `Cursor Agent <cursoragent@cursor.com>`, signed with "a HSM-backed Ed25519 key". The triggering user is added as `Co-authored-by` when known. [6] **[inference]** The signing key is not in the VM (HSM-backed), so commits are signed outside it. The push credential is a separate matter.
- **[fact]** GitLab is different: Cursor creates a project access token per project, and agents commit as its bot user. [16] Shown for contrast only.
- **[community]** Forum, 2026-01-16: `gh` "commands for issues and pull requests fail with ... `GraphQL: Resource not accessible by integration`". Cursor staff: "the integration token isn't getting them [the permissions]". [12] "By integration" is GitHub's wording for App installation tokens, so `gh` in the VM was using the app token.

### 2. Scope: permissions, repos, branches

- **[fact]** `GET /apps/cursor` (GitHub API, app id 1210556, updated 2026-10-13) returns these permissions: `actions: write`, `administration: read`, `checks: write`, `contents: write`, `deployments: read`, `discussions: write`, `emails: read`, `issues: write`, `members: read`, `merge_queues: write`, `metadata: read`, `organization_custom_org_roles: read`, `organization_custom_properties: read`, `organization_custom_roles: read`, `packages: read`, `pages: read`, `pull_requests: write`, `statuses: read`, `workflows: write`. [4]
- **[fact]** Cursor's docs list a shorter set (Repository access, Pull requests, Issues, Checks and statuses, Actions and workflows, Administration read, Custom repository roles, Org custom properties) and say "All permissions follow the principle of least privilege." [17]
- **[fact]** The advisory states the blast radius of a stolen session token: "read/write access to the associated repository, including code, pull requests, checks, and workflows, subject to the agent's granted permissions." [1] **[inference]** "Associated repository" suggests the token is limited to the run's repo(s). Whether its permissions are cut below the app's full set is **[unverified]**.
- **[fact]** Repos: "Selected repositories" at install [17]; Protected Git Scopes lock a GitHub org to one Cursor org [2]. The enterprise repo blocklist does not apply to Cloud Agents. [18]
- **[fact]** Branches: by default "Cursor pushes commits to a new auto-generated branch (`cursor/...`)". With `workOnCurrentBranch: true`, "Cursor pushes directly to that starting ref", or to the PR's head branch for a `prUrl` run. [5] **[absent]** No document says the token is limited to `cursor/` branches, unlike Copilot's `copilot/` rule. **[inference]** With `contents: write`, any branch not covered by branch protection or rulesets is writable. `workflows: write` also allows editing `.github/workflows`.
- **[fact]** Automations: "Pull request triggers don't run on PRs opened from forks ... running external code with the repo's permissions isn't safe." [10] Cursor admits here that the run has the repo's permissions.

### 3. Is the token in the VM, readable by agent-run code?

- **[fact]** "The VM holds a full development environment: the cloned repository, installed dependencies, configured secrets, and network access." "The agent runs code and tools inside the VM." [2] "The agent auto-runs all terminal commands". [6]
- **[fact]** "Other GitHub calls from the agent's VM, such as `gh` or GitHub API requests, don't use the proxy." [7] "Only git traffic uses the proxy. Other requests from the agent, including GitHub API calls and `gh`, come from the Cloud Agent ranges." [6]
- **[fact]** Self-hosted release note (week of Sep 21, 2026): agents on your own machines "ask for credentials on the machine instead of assuming Dashboard secrets or a signed-in GitHub CLI." [3] **[inference]** On Cursor-hosted VMs, a signed-in `gh` is the normal case.
- **[fact]** Cursor blog (2026-07-30) lists "scoped and proxied git remote access" among the cloud agent security features. [8] **[unverified]** whether the git proxy swaps credentials outside the VM (as Claude Code web does) or just routes traffic. Either way, the advisory and the `gh` docs show a token in the session for API calls.
- **[fact]** GHSA-whx2-4gvm-m3r3, "Cloud Agent Browser Sandbox Escape" (high, 2026-07-06): attacker web content reached "an unauthenticated local agent endpoint" from inside the agent container. This allowed "code execution within the affected Cloud Agent sandbox/session. An attacker could access files, repository contents, environment variables, and credentials available to that session." The GitHub App token was exposed. Fixed by requiring auth on the control channel. [1] This is a first-party, published case of the token being reachable from code in the VM.
- **[fact]** Contrast: HTTP MCP servers' "configurations are never present in the cloud agent's VM environment. The agent does not have access to refresh tokens ... Tool calls are proxied through the backend." [9] So Cursor does use the "credential outside the VM" pattern, but for HTTP MCP, not for GitHub.
- **[fact]** Runtime Secrets are "still loaded as environment variables". Their values are redacted from tool results, transcript and commits, but "still visible to users interacting with the agent's environment via the Terminal". [6] **[inference]** Redaction is output filtering. It doesn't stop a child process from reading or sending the value.

### 4. Who pushes, opens PRs, comments, attaches media

- **[fact]** "The agent pushes its branch and opens a draft pull request for a human to review before anything merges." [2] Run events include `pr_created`, `pr_creation_failed`, `artifact_created`. [9]
- **[fact]** Artifacts (screenshots, videos, logs) upload to `cloud-agent-artifacts.s3.us-east-1.amazonaws.com`. "If you use Default + allowlist or Allowlist only, add the exact host ... Blocking the host disables uploads". [6] So the upload leaves from the VM. "Allow posting artifacts to GitHub" embeds them in PR descriptions, using "long, unguessable URLs that are viewable without authentication". [9]
- **[fact]** Comments, review approvals and reviewer requests run as `cursor`. PRs are opened as the user or as `cursor`, depending on the automation's identity. [10]
- **[unverified]** Whether a backend service, not the VM, makes the "create PR" or "embed artifact" API calls. Docs describe the agent doing it. The VM's token can do all of them either way (`pull_requests: write`). [1][4]
- **[inference]** For pstack: the verifier "posts PASS/FAIL" and the owner "opens its PR ... and merges" (see `docs/research/pstack-evidence-flow.md`). Both run with this in-VM app token and an open network.

### 5. Network egress

- **[fact]** "The agent has internet access by default." Modes: Allow all network access, Default + allowlist, Allowlist only. They can be set per user, environment or team, and locked org-wide on Enterprise. [6]
- **[fact]** "Even in Allowlist only mode, a small set of domains remain accessible ... These include Cursor's own services and source control management (SCM) providers." [6]
- **[fact]** The "Default" list is the desktop sandbox default list, which includes `github.com`, `codeload.github.com` and `*.githubusercontent.com`. [11]
- **[fact]** Cursor warns against widening the artifact host to `*.s3.us-east-1.amazonaws.com`: it "creates an exfiltration path for a prompt-injected agent". [6]
- **[fact]** Egress IP ranges are published. Cursor says "We do not recommend allowlisting by IP address as your primary security mechanism." [6]
- **[inference]** GitHub can never be blocked, and the token can write to it. So the token is an exfiltration channel even under "Allowlist only": data can leave as a commit, PR body, comment or issue in the repo.

### 6. What Cursor's security material says

- **[fact]** Security overview, "Autonomy and prompt injection": "an attacker who plants instructions in content the agent reads ... could try to make the agent exfiltrate code to an external host." Layers: egress controls, Runtime Secrets, `.cursorignore`, draft-PR handoff, signed commits. Plus hooks, Bugbot or Security Agents. [2]
- **[fact]** "Are Cloud Agents less secure than local agents? They carry a different risk profile, not a worse one." [2]
- **[fact]** Team follow-ups: "A follow-up message can instruct the agent to read environment variables, print secrets to logs, push credentials to an external endpoint, or perform actions using the original creator's access tokens." "Treat this setting with the same care you would give shared SSH keys". [13]
- **[fact]** Cursor's own run-mode guardrails are "best-effort guardrails rather than a hard security boundary." [19]
- **[fact]** Isolation: per-agent Firecracker microVMs, in a separate AWS account from the rest of Cursor production. [2] Trust Center: https://trust.cursor.com/ (SOC 2 Type 2). [2] Not read in detail.
- **[fact]** First-party advisories in `cursor/cursor` [20]: GHSA-whx2-4gvm-m3r3 is the only one about Cloud Agents. It is the token-exposure case above. The rest are about Desktop, CLI and the sandbox: sandbox escapes via git hooks (GHSA-8pcm-8jpx-hv8r), symlinks, privileged containers, Python venvs; prompt-injection RCE (GHSA-hf2x-r83r-qw5q, GHSA-4cxx-hrm3-49rm, GHSA-rmj9-23rg-gr67); and MCP config issues. None of them involves the GitHub token in a Cloud Agent, apart from GHSA-whx2.
- **[absent]** No Cursor statement found that the GitHub token is kept out of the VM, or that a proxy adds it on the server side for API calls.

### 7. Slack, Linear, GitHub-comment triggers

- **[fact]** Slack: "Cloud Agents read the entire thread for context when invoked". Slack users are matched to Cursor accounts via `users:read`. [14] **[inference]** Anything posted in the thread by anyone becomes agent input, which means more prompt-injection surface.
- **[fact]** Linear: account linking on first use. "A repository provider connection is required for PR creation." The repo is chosen from `[repo=owner/repository]` in issue text, labels, or the default. [21] **[inference]** Issue text steers which repo the agent targets, within the user's access.
- **[fact]** GitHub: `@cursor` / `@cursoragent` comments on issues, PRs or review comments start agents. "You must be a trusted repo commenter". [15] Fork PRs don't trigger automations. [10]
- **[fact]** Automations "run as you" or "as the service account", which changes the PR author. Messages and comments use the `cursor` / Cursor bot identity. [10]
- **[inference]** None of these triggers changes the VM's credential model. Each one starts the same kind of VM with the same app token. They differ only in who can start the agent and what untrusted text it reads.

## Cursor vs others (from prior research)

| Agent | GitHub write cred in sandbox? | Who pushes / PRs | Branch limit | Network |
|---|---|---|---|---|
| Claude Code on the web | No; proxy swaps a session credential | Session via proxy (no deletes/tags) | Proxy-enforced | Limited by default |
| Copilot cloud agent | Tokens reachable in MCP process | Tool pushes; agent can't `git push` | `copilot/` branch | Firewall; GitHub allowed |
| **Cursor Cloud Agent** | **Yes: GitHub App installation token in the session [1]; `gh` signed in [3][7]** | **Agent in VM pushes, opens PR, uploads artifacts [2][6]** | **None documented; can push to the starting ref [5]** | **Open by default; SCM always allowed [6]** |

## Implications for afk-loop

- **pstack's design depends on Cursor putting GitHub write access in the VM that runs untested code.** That is why pstack never mentions a token: Cursor's VM already has one. [1][3][7] Copying pstack's "verifier/owner posts its own evidence" model would mean giving up ADR 0002's Host-only `GH_TOKEN` rule.
- **Cursor's own record shows the risk is real.** GHSA-whx2-4gvm-m3r3 is a published case where web content got code execution in a Cloud Agent and could take the GitHub App token, with repo read/write including workflows. [1] This matches the Copilot, Claude Code Security Review and Codex incidents in `gh-token-in-sandbox.md`.
- **Cursor's mitigations don't fit afk-loop's threat model.** Egress allowlists always allow GitHub [6]. Runtime Secret redaction only filters output; the value is still an env var [6]. A draft PR doesn't stop a stolen token from pushing, editing workflows or posting comments [4]. ADR 0002's Host-only token avoids the whole class.
- **Keep ADR 0002 as is.** For evidence (#20/#23), keep the planned split: the VM writes files, the Host copies them out, validates them, and runs `gh --attach` / `gh pr comment`. This is what Cursor does for HTTP MCP credentials ("never present in the cloud agent's VM") [9], applied to GitHub.
- **One idea worth borrowing [opinion]:** Cursor signs commits with an HSM-backed key outside the VM [6]. afk-loop gets the same effect by having the Host make or verify every commit it pushes from the bundle.
- **If afk-loop ever runs on Cursor Cloud Agents**, assume the agent and any code it runs hold a repo-write App token. At minimum: install the app on Selected repositories only [17], protect `main` and `.github/workflows` with branch protection/rulesets, use "Allowlist only" egress [6], keep Team follow-ups off [13], and treat Slack threads and Linear issues as untrusted input [14][21].

## Sources

1. Cursor GitHub Security Advisory GHSA-whx2-4gvm-m3r3, "Cloud Agent Browser Sandbox Escape" (2026-07-06): https://github.com/cursor/cursor/security/advisories/GHSA-whx2-4gvm-m3r3
2. Cursor Docs, "Cloud Agents: Security overview": https://cursor.com/docs/cloud-agent/security
3. Cursor Docs, "Cloud Agents release notes" (weeks of Sep 21 and Oct 5, 2026): https://cursor.com/docs/release-notes/cloud-agents
4. GitHub REST `GET /apps/cursor` (Cursor's GitHub App, id 1210556, `updated_at` 2026-10-13); app page https://github.com/apps/cursor
5. Cursor Docs, Cloud Agents API endpoints, "Create an agent" (`workOnCurrentBranch`): https://cursor.com/docs/cloud-agent/api/endpoints#create-an-agent
6. Cursor Docs, "Secrets & Network": https://cursor.com/docs/cloud-agent/security-network
7. Cursor Docs, "GitHub" integration, "IP allow list configuration": https://cursor.com/docs/integrations/github#ip-allow-list-configuration
8. Cursor blog, "How we set up our cloud agent environment" (2026-07-30, Hogan & Saripalli): https://cursor.com/blog/cloud-agent-environment
9. Cursor Docs, "Cloud agent capabilities" (artifacts, MCP over HTTP, Cursor Cloud MCP events): https://cursor.com/docs/cloud-agent/capabilities
10. Cursor Docs, "Automations" (identity, fork PRs): https://cursor.com/docs/cloud-agent/automations
11. Cursor Docs, "Run modes", "View default allowed domains": https://cursor.com/docs/agent/security/run-modes#network-access
12. Cursor Community Forum, "Cloud agent having issue with Github Permissions" (2026-01-16; staff reply): https://forum.cursor.com/t/cloud-agent-having-issue-with-github-permissions/149049
13. Cursor Docs, "Cloud Agent settings", "Team follow-ups" / "Lateral movement and secret exposure": https://cursor.com/docs/cloud-agent/settings
14. Cursor Docs, "Slack": https://cursor.com/docs/integrations/slack
15. Cursor Docs, "My Machines" (GitHub `@cursoragent`, trusted commenter): https://cursor.com/docs/cloud-agent/self-hosted/my-machines
16. Cursor Docs, "GitLab" (commit author, project access tokens): https://cursor.com/docs/integrations/gitlab
17. Cursor Docs, "GitHub" (setup, Permissions): https://cursor.com/docs/integrations/github#permissions
18. Cursor Docs, "Model and Integration Management" (repo blocklist scope, Protected Git Scopes): https://cursor.com/docs/enterprise/model-and-integration-management
19. Cursor Docs, "Agent Security": https://cursor.com/docs/agent/security
20. Cursor GitHub Security Advisories list: https://github.com/cursor/cursor/security/advisories
21. Cursor Docs, "Linear": https://cursor.com/docs/integrations/linear
