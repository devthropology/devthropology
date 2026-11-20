# Clanker Follow-Up Plan

We rolled out the new canonical monthly contributor flow:

- New computed table: `computed_repository_contributors`
- New endpoint: `/api/repository/:repositoryId/contributors/monthly`
- Homepage now uses the new endpoint for New, Churned, and Monthly Active Contributors
- Backfill/sync recomputes the table after sync
- New/Churned card behavior preserves the old windows: new in past 30 days, churned inactive 30-60 days

Do these final cleanup items:

1. Align `computed_repository_overview.total_users` with the same canonical contributor definition used by `computed_repository_contributors`.

2. Cleanly delete the legacy contributor monthly paths if unused: `/reports/monthly`, `/reports/contributors`, old on-the-fly SQL, repository methods, service methods, route handlers, schemas/types, and related tests/snapshots. Do not leave compatibility shims or dead code.
