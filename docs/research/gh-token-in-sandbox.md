# Should the Sandbox hold a GitHub token?

Research on ADR 0002's rule "the VM gets only `CLAUDE_CODE_OAUTH_TOKEN`; the Host holds `GH_TOKEN`". Researched 2026-10-25. Sources are first-party unless marked. **[fact]** = documented by the owner; **[opinion]** = a guideline or a researcher's view; **[unverified]** = not confirmed at a primary source.

Setting: the Sandbox runs code the agent wrote and nobody reviewed (builds, tests), has open NAT internet, and the agent reads untrusted text (issue bodies, web pages, dependency output).

## Verdict

- **Keeping the token out of the Sandbox matches industry practice.** No vendor names it an "anti-pattern" in those words. But every source says the same thing: untrusted code plus a write token plus network leads to the token being stolen or misused. GitHub's own fix for "pwn requests" is the split ADR 0002 already uses: an unprivileged job runs the code, and a privileged job posts the results. [1][2]
- **Hosted agents keep long-lived GitHub credentials out of the sandbox, or narrow them hard.** Claude Code on the web: "GitHub credentials ... never enter the session VM". A proxy swaps in the real token. [5][6] Codex cloud strips secrets before the agent phase and blocks the internet by default. [8][9] Copilot cloud agent "cannot directly run `git push`", can push only to its own `copilot/` branch, and runs behind a firewall. [10][11]
- **Each of those controls has been bypassed in practice.** Copilot's firewall allowed github.com, so a token went out "as a commit in the PR, through the allowed channel". Claude Code Security Review leaked `GITHUB_TOKEN` from its process env. A Gemini CLI triage workflow wrote its tokens into a public issue. Codex had a command injection that leaked a user's GitHub token. [14][15][16] So "a scoped token is in the sandbox but the network is filtered" is weaker than "no token in the sandbox".
- **ADR 0002's "Open network" acceptance only holds while the VM has no GitHub token.** Codex and Copilot both list "code or secret exfiltration" as the cost of opening the network. [9][11] Put a token in the VM and the open network goes from "can leak code" to "can leak a credential that acts on GitHub".
- **No GitHub token can be limited to "upload an attachment only".** Fine-grained PATs have no attachments or uploads permission. [19] `gh --attach` takes only `gho_`/`ghp_`/`github_pat_` tokens. It rejects `ghs_` (App installation tokens and Actions `GITHUB_TOKEN`) and `ghu_`, and it needs WRITE on the repo. [20][21] The narrowest token that can post evidence is still a write-level user credential.
- **The narrowest option that works is for the Sandbox to hold no credential at all.** The VM writes the files, the Host copies them out and runs `gh --attach`. This is the pwn-request split. [2] The next best is a short-lived, single-object, pre-signed PUT URL to external storage. It is limited to one bucket key and cannot touch GitHub. [22]
- **Leftover risk (my opinion):** the VM still holds `CLAUDE_CODE_OAUTH_TOKEN` with an open network. claude-code-action warns that a static token "could be partially or fully recovered over time via prompt injection". [4] That is the same class of risk at a lower blast radius.

## Findings

### 1. GitHub: untrusted code + secrets

- **[fact]** Privileged workflow triggers "may have repository write access and access to referenced secrets". Workflows using them "must not explicitly check out untrusted code". Grant `GITHUB_TOKEN` "the minimum required permissions". A compromised action "would have access to all secrets" and "may be able to use the `GITHUB_TOKEN` to write to the repository". Self-hosted runners "can be persistently compromised by untrusted code". [1]
- **[fact]** GitHub Security Lab, "Preventing pwn requests" (2021-08-03): running an untrusted PR's code with a write token is "a dangerous practice that may lead to repository compromise". Even without secrets, the job "still has the read/write repository token in memory that is potentially available to any running program". The recommended pattern is that the untrusted build runs under `pull_request` (read-only, no secrets) and saves its results as artifacts. A separate privileged `workflow_run` then posts the PR comment, treating the artifact contents as untrusted data and never running them. [2]
- **[fact]** GitHub recommends fine-grained PATs over classic ones, GitHub Apps for long-lived integrations, an expiration on every token, and "Treat your access tokens like passwords". [3] App installation tokens "expire after 1 hour". They can be cut down to chosen `repositories` and a `permissions` subset. [17] `GITHUB_TOKEN` is an App installation token limited to the workflow's repo. It expires at job end (max 6 h on hosted runners, 24 h on self-hosted). [18]

### 2. Anthropic

- **[fact]** Claude Code security docs, under best practices for untrusted content: "Use virtual machines (VMs) to run scripts and make tool calls". [5]
- **[fact]** Cloud sessions: "GitHub credentials are stored encrypted on Anthropic's servers and never enter the session VM. The VM holds a short-lived credential scoped to that session, and GitHub traffic goes through an Anthropic proxy that attaches the GitHub credential on the server side." The proxy rejects branch deletions and tag pushes. Network access is "limited by default". [5] Inside the VM, git uses "a scoped credential, which the proxy verifies and swaps for your actual GitHub token". The built-in GitHub tools work "so your token never enters the container". Other API keys go in as "network secrets" that the proxy adds after the request leaves the VM, "so the key itself stays outside the VM". Plain env vars can be read by anyone who uses the environment. [6]
- **[fact]** Sandboxing docs: by default, sandboxed commands inherit env vars "including any secrets". "Allowing broad domains such as `github.com` can create paths for data exfiltration". The example config denies `GITHUB_TOKEN`. [7]
- **[fact]** claude-code-action: it uses "a short-lived token scoped specifically to the repository". By default Claude commits to a branch and a human opens the PR. With non-write users: "**Do not use a personal access token** — a static token does not rotate between runs and could be partially or fully recovered over time via prompt injection." The env scrub "reduces but does not eliminate prompt injection risk". [4]

### 3. OpenAI Codex cloud

- **[fact]** Secrets "are only available to setup scripts. For security reasons, secrets are removed before the agent phase starts." Internet is on for setup and "off by default" for the agent phase. [8]
- **[fact]** The risks it lists for agent internet access include "Code or secret exfiltration". Its example is a GitHub issue that tells the agent to send the last commit to an attacker's server. Advice: allowlist domains, limit to `GET`/`HEAD`/`OPTIONS`, and keep access "as limited as possible". [9]
- **[unverified]** How Codex cloud holds the GitHub credential and who pushes is not stated on the pages read. The docs say only that after a task "You can open a PR". [8]

### 4. GitHub Copilot cloud (coding) agent

- **[fact]** It "can only perform simple push operations" and "cannot directly run `git push`". It pushes to one branch, a new `copilot/` branch unless it is working on an existing PR. Workflows don't run until a user with write access approves them. Hidden characters are filtered out of input. Only users with write access can trigger it. [10]
- **[fact]** The firewall "only applies to processes started by the agent via its Bash tool". It does not cover MCP servers or setup steps. "Sophisticated attacks may bypass the firewall", and it "should not be considered a comprehensive security solution". GitHub hosts are always allowed. [11] It runs in an "ephemeral" environment and opens one PR per task. [12]

### 5. OWASP and similar guidance (all [opinion])

- OWASP LLM06:2025 Excessive Agency names three root causes: excessive functionality, permissions and autonomy. Fixes: "Limit the permissions ... to the minimum necessary", act in the user's context with the narrowest scope, have a human approve high-impact actions, and enforce authorization downstream rather than trusting the LLM. [13]
- OWASP Top 10 for Agentic Applications (2026-12-09) exists. Its contents (PDF) were not read here. **[unverified]** [23]
- Meta's "Agents Rule of Two" (2025-10-31): within a session, an agent should have at most two of [A] untrusted inputs, [B] sensitive systems or data, [C] the ability to change state or communicate externally. [24] Simon Willison's "lethal trifecta" (2025-06-16) makes the same point: "avoid that lethal trifecta combination entirely". [25] The afk-loop Sandbox already has [A] and [C] (open network). A GitHub token adds a stronger [B] and more [C].

### 6. Real incidents (first-party write-ups)

- **Comment and Control** (researcher Aonan Guan, April 2026). [14]
  - Claude Code Security Review leaked `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` from its env via a PR comment or the Actions log. Anthropic said the action "is not designed to be hardened against prompt injection" and blocked `ps`. The author notes `cat /proc/*/environ` still works.
  - Copilot agent leaked `GITHUB_TOKEN`, `GITHUB_COPILOT_API_TOKEN` and others from its MCP process. The output was base64-encoded and committed to the PR, because "`github.com` is whitelisted". GitHub called it a "known architectural limitation" (per SecurityWeek [26]).
  - Author's advice **[opinion]**: "The only defensible posture is allowlist-only".
- **PromptPwnd** (Aikido, 2025-12-04). A Gemini CLI triage workflow held a GitHub token with read and write on issues and PRs. A malicious issue made the agent run `gh issue edit`, which put the tokens into the public issue body. Google fixed it in 4 days. Advice: don't let agents write to issues or PRs, and limit token exposure. [15]
- **Codex cloud branch-name command injection** (BeyondTrust Phantom Labs, 2026-03-30). It leaked the user's GitHub token from the Codex container. OpenAI rated it Critical and "limited token scope and lifetime". **[unverified]**: the primary post returned 403 when fetched, so these details come from search summaries of it. [16]
- **GitHub MCP toxic flow** (Invariant Labs, 2025-05-26). An injected public issue made an agent copy private-repo data into a public PR, using the user's own GitHub credentials. No token was stolen; the agent's write access was enough. [27]
- **Nx "s1ngularity"** (Nx advisory, 2025-08-27). Rogue npm versions searched machines for credentials and posted them to a repo under the victim's own GitHub account. The root cause was a `pull_request_target` workflow with a read/write `GITHUB_TOKEN`. [28] This shows that a GitHub token alone is also an exfiltration channel.

## Hosted agents compared

| Agent | Long-lived GitHub cred in sandbox? | What the sandbox gets | Who pushes / opens PR | Network |
|---|---|---|---|---|
| Claude Code on the web | No [5][6] | Short-lived, session-scoped credential; proxy swaps it for the real token | Session pushes branches through the proxy, which blocks deletes and tags | Limited by default (Trusted allowlist) [6] |
| claude-code-action | Yes, in the runner env [4][14] | Short-lived repo-scoped App token or `GITHUB_TOKEN` | Claude commits to a branch; a human opens the PR by default [4] | Runner default (open) |
| Codex cloud | Secrets removed before agent phase [8]; GitHub cred handling not documented on pages read | Env vars only | User opens the PR from the UI [8] | Off by default in agent phase [9] |
| Copilot cloud agent | Tokens were reachable in the MCP process [14] | Agent can't run `git push`; tool pushes to one `copilot/` branch [10] | Copilot pushes and opens the PR; workflows need approval [10] | Firewall on Bash only; GitHub allowed [11] |

## Narrowest credentials for posting evidence from the Sandbox

| Option | Narrowest scope possible | Can it attach video/images? | Blast radius if stolen |
|---|---|---|---|
| Fine-grained PAT, one repo, `Pull requests: write` (+`Metadata: read`) | One repo; PR/comment/review APIs; no `Contents` so no push [19] | Unknown which fine-grained permission the user-attachments endpoint checks **[unverified]**; `gh` accepts `github_pat_` and checks the repo role is WRITE+ [20] | Edit or close PRs, post comments, submit reviews in that repo until expiry |
| Classic PAT / OAuth (`gho_`) | `repo` scope = all repos of the user [3] | Yes, documented path [20][29] | Every repo the user can write to |
| GitHub App installation token | 1 h; chosen repos and permissions [17] | No: `gh --attach` rejects `ghs_` [21] | Small, but can't do the job |
| Actions `GITHUB_TOKEN` | Job lifetime; one repo [18] | No (`ghs_`) [21]; also doesn't exist outside Actions | n/a |
| Pre-signed S3 (or similar) PUT URL | One object key, time-limited (up to 7 days via SDK) [22] | Upload only; the Host must still put the link in the PR. Inline video for external URLs isn't documented (see prior research) | Overwrite or upload that one object until expiry; no GitHub access |
| **No credential: Host uploads** | n/a | Yes: Host runs `gh --attach` on files copied out of the VM | None added to the VM |

There is no "attachments only" GitHub scope. Uploads to user-attachments can't be deleted through any API (prior research, `docs/research/pr-evidence-attachment.md`). A stolen write token could therefore leave permanent uploads.

## Implications for afk-loop

- **Keep ADR 0002's rule.** It matches GitHub's pwn-request split [2], Anthropic's credential-outside-the-VM design [5][6], and Codex's "secrets removed before the agent phase" [8]. Its "Open network" acceptance depends on this rule and should say so (it already does: "it holds no GitHub token").
- **For PR evidence (#20/#23), the VM writes files and the Host uploads them.** The VM saves screenshots and video to a known guest path. The Host copies them out with the same channel as the git bundle. The Host checks type and size (the files are untrusted data, as GitHub says of artifacts [2]) and runs `gh pr create/comment --attach`. The Sandbox never sees a GitHub credential.
- **If the Sandbox posted evidence itself**, it would need at least a fine-grained PAT with write-level reach on DailyQuest. No narrower GitHub token can attach files [19][20][21]. Risks:
  - A prompt-injected agent, or any test or dependency code, can read the token from env or `/proc` and send it out over the open network. This has happened with Claude Code Security Review and Copilot. [14]
  - Even with only `Pull requests: write`, the token can edit PR bodies (hiding or forging evidence before review), post comments, and submit reviews. With `Contents: write` it can push. The pull-from-bundle and Host-reset model would be bypassed.
  - The token outlives the VM (PATs last days or more; a deleted VM doesn't revoke it).
  - A GitHub token is itself an exfiltration channel, even with a filtered network: data can be pushed as a commit or posted as a comment or upload. [14][15][28]
  - The VM would then hold two credentials with an open network, breaking the reason ADR 0002 accepts that risk.
- **If the Host upload route is ever impractical**, a short-lived pre-signed PUT URL per file is the next least-privilege step. It has no GitHub reach. [22]
- **Leftover risk to note in ADR 0002 [opinion]:** `CLAUDE_CODE_OAUTH_TOKEN` sits in the open-network VM and can be read by test code (the ADR already says this). Anthropic's own guidance warns that static tokens are recoverable by prompt injection. [4] If this matters, use a network allowlist for the VM (Anthropic API, package registries) rather than full NAT.

## Sources

1. GitHub Docs, "Security hardening for GitHub Actions": https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
2. GitHub Security Lab, "Keeping your GitHub Actions and workflows secure Part 1: Preventing pwn requests" (2021-08-03): https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/
3. GitHub Docs, "Managing your personal access tokens": https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
4. anthropics/claude-code-action, `docs/security.md`: https://github.com/anthropics/claude-code-action/blob/main/docs/security.md
5. Claude Code Docs, "Security": https://code.claude.com/docs/en/security
6. Claude Code Docs, "Configure cloud environments" (GitHub proxy, network secrets): https://code.claude.com/docs/en/cloud-environments
7. Claude Code Docs, "Sandboxing": https://code.claude.com/docs/en/sandboxing
8. OpenAI Codex docs, "Cloud environment": https://learn.chatgpt.com/docs/environments/cloud-environment (was developers.openai.com/codex/cloud/environments)
9. OpenAI Codex docs, "Internet access": https://learn.chatgpt.com/docs/cloud/internet-access
10. GitHub Docs, "Risks and mitigations for Copilot cloud agent": https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations
11. GitHub Docs, "Customizing or disabling the firewall for Copilot cloud agent": https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall
12. GitHub Docs, "About Copilot cloud agent": https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
13. OWASP GenAI, "LLM06:2025 Excessive Agency": https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
14. Aonan Guan, "Comment and Control" (April 2026): https://oddguan.com/blog/comment-and-control-prompt-injection-credential-theft-claude-code-gemini-cli-github-copilot/
15. Aikido Security, "PromptPwnd" (2025-12-04): https://www.aikido.dev/blog/promptpwnd-github-actions-ai-agents
16. BeyondTrust Phantom Labs, Codex command injection (2026-03-30; fetch returned 403): https://www.beyondtrust.com/blog/entry/openai-codex-command-injection-vulnerability-github-token
17. GitHub Docs, "Generating an installation access token for a GitHub App": https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
18. GitHub Docs, "GITHUB_TOKEN": https://docs.github.com/en/actions/concepts/security/github_token
19. GitHub REST, "Permissions required for fine-grained personal access tokens": https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
20. cli/cli `internal/attachments/client.go` @ v2.99.0 (`uploadTokenTypes`, `uploadPermissions`): https://github.com/cli/cli/blob/v2.99.0/internal/attachments/client.go
21. cli/cli `internal/gh/gh.go` @ v2.99.0 (TokenType prefixes: `gho_`, `ghp_`, `github_pat_`, `ghu_`, `ghs_`): https://github.com/cli/cli/blob/v2.99.0/internal/gh/gh.go
22. AWS S3 User Guide, "Uploading objects with presigned URLs": https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
23. OWASP GenAI, "OWASP Top 10 for Agentic Applications for 2026": https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
24. Meta AI, "Agents Rule of Two" (2025-10-31): https://ai.meta.com/blog/practical-ai-agent-security/
25. Simon Willison, "The lethal trifecta for AI agents" (2025-06-16): https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
26. SecurityWeek (secondary, for vendor responses): https://www.securityweek.com/claude-code-gemini-cli-github-copilot-agents-vulnerable-to-prompt-injection-via-comments/
27. Invariant Labs, "GitHub MCP Exploited" (2025-05-26): https://invariantlabs.ai/blog/mcp-github-vulnerability
28. Nx security advisory GHSA-cxm3-wv7p-598c (2025-08-27): https://github.com/nrwl/nx/security/advisories/GHSA-cxm3-wv7p-598c
29. GitHub changelog, "GitHub CLI: media in issues, pull requests and comments" (2026-09-01): https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments
