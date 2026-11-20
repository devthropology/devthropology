# Skill: GitHub API Explorer

Use GitHub's REST API and local debug endpoints to inspect PRs, commits, files,
and raw payloads.

## Auth

Load credentials from the repo `.env` before making requests:

```bash
set -a && source .env && set +a
```

Use the token in requests:

```bash
curl -sS \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/..."
```

## Repo Scoping

- Prefer explicit org/repo when the user names one, for example `tailscale/tailscale`
- Otherwise use `.env` values: `$REPO_OWNER` and `$REPO_NAME`

Example:

```bash
"https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/pulls/123/commits?per_page=100"
```

## Common GitHub Routes

- PR commits: `/repos/{org}/{repo}/pulls/{pr}/commits?per_page=100`
- PR files: `/repos/{org}/{repo}/pulls/{pr}/files?per_page=100`
- PR details: `/repos/{org}/{repo}/pulls/{pr}`
- Issue/PR record: `/repos/{org}/{repo}/issues/{number}`
- User profile: `/users/{login}`

## Useful jq Patterns

Commit summary:

```bash
curl -sS ... | jq '{
  count: length,
  shas: [.[].sha],
  unique_author_logins: ([.[].author?.login] | unique),
  unique_committer_logins: ([.[].committer?.login] | unique),
  author_committer_pairs: ([.[] | {
    sha,
    author: .author?.login,
    committer: .committer?.login,
    git_author_name: .commit.author.name,
    git_committer_name: .commit.committer.name
  }] | unique)
}'
```

Inspect full commit messages for co-authors:

```bash
curl -sS ... | jq -r '.[] | "SHA: \(.sha)\nMESSAGE:\n\(.commit.message)\n---"'
```

## Local App Routes

These use the app's wrapper instead of raw GitHub API.

- Debug hydrated issue: `GET /debug/:id`
- Debug PR files only: `GET /debug/prf/:id`

Example:

```bash
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/debug/131266" | jq
```

Notes:

- `/debug/:id` is keyed by GitHub issue/PR number, not `repository_id`
- It uses the repo configured in the running backend, not an org/repo passed in the URL
- It requires app auth, not `GH_TOKEN`

## Quick Workflow

1. `source .env`
2. Decide whether to use raw GitHub API or local wrapper route
3. Use explicit org/repo if the user provided one
4. Add `| jq` for summaries and `jq -r` for readable commit messages
5. If checking co-authors, inspect `commit.message` for `Co-Authored-By:` trailers
