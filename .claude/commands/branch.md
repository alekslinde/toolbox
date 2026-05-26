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

1. Review what's being worked on: the user's request, any staged/unstaged changes (`git diff --stat`), and the current branch name if it's already descriptive.
2. Pick the right prefix from the table above.
3. Write a slug that captures *what* is changing in 2–4 words.
4. Propose the branch name to the user in one line, e.g. `fix/woff2-parse-error`.
5. Ask for confirmation or an alternative before running `git checkout -b`.
6. Run: `git checkout -b <branch-name>`
