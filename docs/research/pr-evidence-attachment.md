# How the Host can attach screenshots and video to a PR

Research for #23 (part of #20). Researched 2026-10-23. Facts only; no pick.

Evidence: a few PNG screenshots + one ~10 MB simulator video (mp4/mov). Target repo `knn90/DailyQuest` is private. Only the Host holds a token and runs `gh`.

## Headline

The ticket premise ("web UI only") is out of date. `gh` v2.99.0 (2026-09-01) added a repeatable `--attach` flag to `gh pr create`, `gh pr edit`, `gh pr comment` (and the issue equivalents). It uploads to the same user-attachments store the web UI uses and writes the URL into the body. [1][2][3]

There is still no documented REST/GraphQL endpoint for this. `gh` calls `POST https://uploads.github.com/user-attachments/assets?name=…&content_type=…&repository_id=…` directly; that endpoint is not in the REST reference. [4][1]

Host's installed `gh` is 2.86.0; needs upgrade to >= 2.99.0 for `--attach`.

## Options

### 1. `gh … --attach` (user-attachments)

- How: `gh pr create --attach ./a.png --attach ./run.mp4`, or `gh pr comment <n> --attach …`. Alt text via `path#alt` (not for video). Local paths already referenced in the body get rewritten to the uploaded URL; others appended in flag order. Same file can't be attached twice. [2][3]
- Batch limit: 50 files per command (`fix(attach): limit batches to 50 files`). [3]
- Types: PNG, JPEG, GIF, WebP, SVG, MP4, MOV, WebM. CLI accepts image/media only. [1][2]
- Size: images/GIFs 10 MB; video 10 MB on Free plan, 100 MB on paid plan (same as web upload). [1][5] A ~10 MB video on a Free-plan repo is right at the cap.
- Auth: needs write/maintain/admin on the repo; read/triage gets 404. Changelog says OAuth (`gh auth login`) or classic PAT [1]; the v2.99.0 source allowlist also includes fine-grained PATs [4]. Host's knn90 token is OAuth (`gho_`). Not supported on GHES. [1][4]
- Rendering: inline images and inline video player (codec support browser-specific; H.264 recommended). [5]
- Private repo: "only people with access to the repository can view the uploaded files"; since 2023-05 private-repo attachments require login. Email notifications from private repos don't show images. [5][6]
- Retention: not documented. [5]
- Upload is irreversible (no delete API); `gh` refuses early on wrong host/token/permission for that reason. [4]

### 2. Commit files to the PR branch or a separate evidence branch

- How: `git push` the files; reference in PR body/comment with `../blob/<branch-or-sha>/path.png?raw=true` (relative) or the absolute `https://github.com/OWNER/REPO/blob/<sha>/path?raw=true`. Use a commit SHA for a permanent link. [7][8]
- Size: Git warns > 50 MiB, GitHub blocks > 100 MiB per file (LFS beyond); repos ideally < 1 GB, < 5 GB strongly recommended. [9]
- Types: any file.
- Rendering: images render inline in PRs/comments. [7] Video from a blob URL: no doc says it renders as a player; GitHub documents inline video only for uploaded attachments [5]. Treat as link-only (unverified).
- Private repo: relative image links work "only if the viewer has at least read access". [7]
- Retention: as long as the commit is reachable. Committing to the PR branch puts binaries in the merged history (unless squashed/removed); a separate orphan evidence branch keeps them out of `main` but still grows the repo.

### 3. Release assets

- How: `gh release create <tag> --draft …files` / `gh release upload`; REST `POST https://uploads.github.com/repos/OWNER/REPO/releases/ID/assets?name=…` with raw body. [10][11]
- Size: each file < 2 GiB; up to 1000 assets per release. [10]
- Types: any.
- Private repo: anyone with read access can view releases. [10] Private download via API needs auth + `Accept: application/octet-stream` (302 redirect). [11]
- Rendering: no doc says release-asset URLs render inline in PR markdown, especially for private repos (unverified; video certainly not documented). Effectively a download link.
- Retention: until the release/asset is deleted. Pollutes the Releases list (drafts reduce this).

### 4. Gists

- `gh gist create` rejects binary files ("binary file not supported"). [12] REST gist content is text; API returns <= 1 MB per file, > 10 MB needs `git clone` of the gist. [13]
- Secret gists "aren't private" — anyone with the URL can view. [14] Bad fit for private-repo evidence.
- Pushing binaries via the gist's git remote may work but is undocumented for rendering; not pursued.

### 5. Actions artifacts uploaded from outside Actions

- Not possible via public API: the artifacts REST API has list/get/download/delete only, no create/upload. [15]
- `@actions/artifact` requires `ACTIONS_RUNTIME_TOKEN` and `ACTIONS_RESULTS_URL`, which exist only inside a workflow run. [16]
- Workaround would be a workflow that receives files (e.g. from a pushed branch) and re-uploads them — adds a hop with no gain over option 2.
- Download: zip only, URL expires after 1 minute, needs `repo` scope for private. [15] Not inline-renderable.
- Retention: default 90 days; private repos configurable 1–400 days. [17]

### 6. Web UI user-attachments flow (pre-2.99 hacks)

- Web drag-and-drop uploads via a browser-session flow; no public API. Third-party extensions (e.g. `gh-image`) reverse-engineer it with a `user_session` cookie. [18] Superseded by option 1, which uses a token.

### 7. External storage (S3/R2/etc.)

- Any public or presigned HTTPS URL in `![](url)` renders as image ("add a link to an online image"). [7] Video from external URL: not documented to render as player.
- Private-repo evidence would be publicly reachable by URL unless presigned with expiry (then images break after expiry). Needs extra credentials on the Host. Retention = whatever you configure.

## Summary table

| Option | Inline img | Inline video | Size cap | Private-repo gated | Retention | Extra infra |
|---|---|---|---|---|---|---|
| `gh --attach` | yes | yes | 10 MB img; 10/100 MB video | yes (login + repo access) | undocumented | gh >= 2.99 |
| Commit to branch | yes | not documented | 100 MiB/file | yes (read access) | while reachable | none |
| Release asset | not documented | no | 2 GiB | yes (read access) | until deleted | none |
| Gist | n/a (no binary via gh) | no | text-oriented | no (URL = access) | until deleted | none |
| Actions artifact | no | no | plan storage | yes | 90 d default | not possible from Host |
| External storage | yes | not documented | provider | no / presigned | configurable | bucket + creds |

## Sources

1. GitHub changelog, "GitHub CLI: media in issues, pull requests and comments" (2026-09-01): https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments
2. GitHub Docs, "Attaching files with GitHub CLI": https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli
3. cli/cli release v2.99.0 notes: https://github.com/cli/cli/releases/tag/v2.99.0
4. cli/cli source `internal/attachments/client.go` @ v2.99.0: https://github.com/cli/cli/blob/v2.99.0/internal/attachments/client.go ; `internal/ghinstance/host.go` (`UserAssetUploadPrefix`); PR https://github.com/cli/cli/pull/14180
5. GitHub Docs, "Attaching files": https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
6. GitHub changelog, "More secure private attachments" (2023-05-08): https://github.blog/changelog/2023-05-08-more-secure-private-attachments
7. GitHub Docs, "Basic writing and formatting syntax" → Images: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#images
8. GitHub Docs, "Getting permanent links to files": https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files
9. GitHub Docs, "About large files on GitHub": https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
10. GitHub Docs, "About releases": https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
11. GitHub REST, "Release assets": https://docs.github.com/en/rest/releases/assets
12. cli/cli source `pkg/cmd/gist/create/create.go` @ v2.99.0: https://github.com/cli/cli/blob/v2.99.0/pkg/cmd/gist/create/create.go
13. GitHub REST, "Gists": https://docs.github.com/en/rest/gists/gists
14. GitHub Docs, "Creating gists": https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists
15. GitHub REST, "Artifacts": https://docs.github.com/en/rest/actions/artifacts
16. actions/toolkit `packages/artifact/src/internal/shared/config.ts`: https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/shared/config.ts
17. GitHub Docs, "Configuring the retention period for GitHub Actions artifacts and logs in your organization": https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization
18. gh-image extension (third-party, for context only): https://github.com/drogers0/gh-image
