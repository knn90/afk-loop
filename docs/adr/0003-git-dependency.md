# 3. Projects take the loop as an npm git dependency

Status: accepted.

## Context

The loop began inside one project's `.sandcastle/`. A second project, on another Mac, needs the same loop. Sandcastle offers nothing for sharing a loop between repos.

## Decision

The loop is its own repo, `afk-loop`. Each project names it in its `.sandcastle/package.json`:

```json
"afk-loop": "git+https://github.com/knn90/afk-loop.git"
```

- **Pinned by the lockfile**: the project's `package-lock.json` holds a commit. `npm update afk-loop` moves it, as a commit in that project. No tags, no following head. A PR's commit therefore says which loop revision made it.
- **No build step**: `tsx` runs the `.ts` files from `node_modules`.
- **Public, over HTTPS**: any Mac installs it with no credentials. `package.json` holds one URL, so a private repo would need every Mac to resolve the same SSH host or hold the same access.
- **Changes come by PR**: `main` takes no direct push. The check is this repo's tests and typecheck on Node; the loop does not work its own issues, since a Sandbox has no Test run for it.
- **Trying a change first**: `npm link`, or a `file:` path, from the project to a local checkout.

## Rejected

- **Template repo**: each project gets a copy, and a fix must be made once per project.
- **Git subtree or submodule**: the loop's files sit in the project's tree, where agents can edit them, and updating is a merge, not a version bump.
- **One checkout per Mac, outside the projects**: nothing in a project records which loop revision ran.
- **Private repo**: per-Mac auth for every install, for code that holds no project's details.
