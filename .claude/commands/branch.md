Create a meaningful git branch name for the current task and check it out.

## Rules

| Prefix | When |
|---|---|
| `feature/` | New tool, new page, new capability |
| `fix/` | Bug fix or broken behaviour |
| `improve/` | Enhancement to an existing feature |
| `chore/` | Deps, config, tooling, refactor with no user-visible change |

Slug format: `<prefix>/<short-description>` in `kebab-case`, max 40 chars total, no ticket numbers, no dates.

Good examples:
- `fix/woff2-parse-error`
- `feature/svg-optimizer`
- `improve/font-converter-woff2-output`
- `chore/update-astro-4`

Bad examples (avoid):
- `fix/bug` — too vague
- `feature/add-new-tool-for-converting-images-to-webp` — too long
- `claude/affectionate-brown-Y98Dq` — not human-readable

## Steps

1. Check whether the current branch has a merged or closed PR.

   `gh` is not available — use the GitHub MCP tool instead:

   ```
   mcp__github__pull_request_read  method=get  owner=alekslinde  repo=toolbox  pullNumber=<N>
   ```

   To find the PR number, search recent PRs or ask the user. The `state` field will be `"open"`, `"closed"`, or the `merged` boolean will be `true`.

- If `merged: true` or `state: "closed"`: identify any commits on the current branch that are **not** on `main` (they were pushed after the PR was merged and therefore orphaned):

```bash
git log --oneline main..HEAD
```

  - If there are orphaned commits: note their hashes — they will need to be cherry-picked onto the new branch after it is created.
  - Then fetch and check out `main` before creating the new branch:

```bash
git fetch origin main && git checkout main && git pull origin main
```

- If `state` is `"OPEN"` or no PR exists: stay on the current branch for context, then continue from step 2.

2. Review what's being worked on: the user's request, any staged/unstaged changes (`git diff --stat`), and the current branch name if it's already descriptive.
3. Pick the right prefix from the table above.
4. Write a slug that captures *what* is changing in 2–4 words.
5. Propose the branch name to the user in one line, e.g. `fix/woff2-parse-error`.
6. Ask for confirmation or an alternative before running `git checkout -b`.
7. Run: `git checkout -b <branch-name>`
8. If there were orphaned commits (from step 1), cherry-pick them onto the new branch:

```bash
git cherry-pick <hash> [<hash> ...]
git push -u origin <branch-name>
```

Tell the user which commits were cherry-picked and why.
