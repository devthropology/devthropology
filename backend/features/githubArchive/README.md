# GitHub API archives

Capture raw API responses after successful DB persistence. Closed/merged PRs and
real issues (open or closed) are included; open PRs and synthetic missing/deleted/
moved records are excluded. CLI, API and cron use the same injected archive.

```dotenv
GH_ARCHIVE_LOCAL=true
GH_ARCHIVE_DIR=./data
GH_ARCHIVE_PREFIX=gh_api_archive/local
GH_ARCHIVE_LEVEL=6
```

Relative directories resolve from the repository root; absolute paths work for
mounted storage. Defaults are disabled, `./data`, `gh_api_archive` and level 6.
Configuration is read when constructing a sync, not for unrelated CLI commands.
The default directory is gitignored and excluded from Docker builds. Keep custom
directories out of source control and monitor disk usage.

```text
data/gh_api_archive/local/<org>/<repo>/<number>/2026_10_18_195841_211Z.json.zst
```

Names use UTC and sort chronologically. Each file contains one JSON object with
`version: 1`, `captureId`, `capturedAt` (after DB commit),
`repository: { owner, name }`, `number`, `type`, `fetchedAt` (fetch start), and
`responses` (endpoint URL, HTTP status and raw JSON for every fetched page).
Unknown fields survive parsing; request/auth headers are not stored. Only fetched
data is included, subject to GitHub's endpoint and pagination limits.

Files use native Node zstd and restricted permissions. Publication is complete and
no-overwrite; unfinished temporary files end in `.partial`. Inspect with
`zstd -dc capture.json.zst | jq .` or Node's `createZstdDecompress()`.

**Best-effort, fail-fast:** DB commit and file writing are not one transaction.
A crash or disk error after commit can lose that capture. Disk errors stop the
sync to avoid losing further captures; they do not undo DB commits. Normal sync
skips already-persisted closed records, so it cannot automatically recover missing
captures. There is no replay, transactional backup or retention policy here.
Inspect/remove interrupted temporary files only when no writer is active.

## Optional S3/R2 delivery

See [runtime setup](../../../README.md#github-archive-storage-optional) for bucket-scoped
credentials and persistent storage. Set `GH_ARCHIVE_S3=true` to enable delivery;
`GH_ARCHIVE_LOCAL` independently controls retention after upload.

- LOCAL only: write directly to the retained local path.
- S3 only: stage on disk, upload, then delete the staged file.
- Both: stage, upload, then move the file to the retained local path.
- Both disabled: no archive work.

S3 settings: `GH_ARCHIVE_S3_BUCKET`, `GH_ARCHIVE_S3_REGION` (`auto` for R2),
and optional `GH_ARCHIVE_S3_ENDPOINT`. The shared `GH_ARCHIVE_PREFIX` applies
to both object keys and retained local files. S3 settings are validated only
when uploads are enabled.

Disk writes happen per persisted PR. At sync completion—including early exits and
errors—finalized pending files for that repository/destination are uploaded
sequentially with one SDK client/connection pool per batch. Successful uploads
report a count and elapsed time. Failure retains the remaining files for the next
run; if sync already failed, its original error is preserved.

Pending captures live under `data/.pending/<destination-hash>/<org>/<repo>/...`.
The hash covers endpoint, region, bucket and prefix, never credentials. Changing
destination settings cannot silently redirect old private payloads. Drain old
pending files with the old destination settings before changing them. Existing
LOCAL-only captures are not retroactively uploaded.

A killed process leaves finalized files for the next sync's upload phase.
Interrupted `.partial` files are never uploaded. An outage can grow pending disk
usage across runs: monitor it. There is no background worker, automatic retention,
or transactional outbox. Concurrent uploads may PUT the same immutable object key.
The runtime reports upload failure separately in its message, but currently marks
the overall sync job failed even when DB persistence completed.
