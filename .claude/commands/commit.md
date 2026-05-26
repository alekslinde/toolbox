Write a meaningful git commit message for the staged changes and commit.

## Message format

```
<Subject line>

<Body — optional>
```

**Subject line** (≤ 72 chars):
- Imperative mood, sentence case: "Fix", "Add", "Remove", "Update", "Refactor"
- No trailing period
- Captures *what* changed and (if non-obvious) *why*

**Body** (optional, separated by a blank line):
- Use when the subject alone doesn't explain the motivation or trade-off
- Wrap at 72 chars
- Explain *why*, not *what* — the diff already shows what

## Verb guide

| Verb | When |
|---|---|
| `Add` | New file, feature, tool, dependency |
| `Fix` | Corrects broken behaviour |
| `Remove` | Deletes something |
| `Update` | Changes existing behaviour or content |
| `Refactor` | Code restructure with no behaviour change |
| `Improve` | Enhancement — works before, works better after |
| `Chore` | Deps, config, tooling — nothing user-visible |

## Good examples

```
Fix WOFF2 parse error — decompress with wawoff2 before opentype.js
```
```
Add /branch command for meaningful branch naming
```
```
Remove font-inspector placeholder (Mixfont Lens retired)
```
```
Refactor: extract HelpfulButton and ToolSEO into shared components

Both were copy-pasted across 12 tool pages. Extracting them removes
~200 lines of duplication and makes future changes to the footer CTA
a one-file edit.
```

## Bad examples (avoid)

- `Fix bug` — too vague
- `WIP` — not a real commit message
- `Changes` — says nothing
- `fix: woff2` — lowercase, no context
- `Fixed the WOFF2 parsing issue that was causing an error when users tried to upload WOFF2 font files to the font converter tool` — too long for subject

## Steps

1. Run `git diff --staged --stat` to see what's staged. If nothing is staged, check `git status` and stage the relevant files first.
2. Read the staged diff to understand the change.
3. Draft a subject line using the verb guide above.
4. Decide if a body is needed — add one only if the motivation isn't obvious from the subject.
5. Propose the message to the user.
6. On confirmation, run:

```bash
git commit -m "$(cat <<'EOF'
<subject>

<optional body>
EOF
)"
```
