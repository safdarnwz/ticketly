# Release process (CI/CD)

```
 feat/… fix/… ──PR──▶ main ──▶ stage ──▶ uat ──▶ prod ──▶ GitHub Release vYYYY.MM.DD.N
                 CI gates      └────── the same build artifact, deployed and verified at each step ──────┘
```

## 1. One change, one pull request

Every feature or bug fix is its own branch and PR into `main`. The PR title is
a [Conventional Commit](https://www.conventionalcommits.org/) (`feat(booking): …`,
`fix(payment): …`) — it becomes the squash commit and the release notes. Never
commit to `main`, `stage`, `uat` or `prod` directly; a hot fix is a normal PR.

## 2. CI — `.github/workflows/ci.yml`

Runs on every PR into `main` and every push to `main`, gates in parallel:

| Gate | What it checks |
|---|---|
| PR title | Conventional Commit format |
| Quality | Prettier, ESLint, `tsc`, module-boundary ratchet, shellcheck, actionlint |
| Unit | unit + architecture tests with coverage (summary on the run, lcov artifact) |
| Migrations | apply all, revert the newest, re-apply — every migration must be reversible |
| E2E | the real API against Postgres with the seeded demo operator |
| Build | production build + release package (the migrations ship with it) |
| Security | gitleaks over the full history; `npm audit` of production dependencies (blocks on critical, reports high); Semgrep SAST (report-only until its baseline is triaged) |
| **CI OK** | passes only when every gate above passed — the one required check |

A newer push to the same PR cancels the older run.

## 3. CD — `.github/workflows/pipeline.yml` + `deploy.yml`

When CI is green:

1. **Merge** (PRs): approved, squash-merged, branch deleted.
2. **Build once**: the merged commit is built and packaged into
   `ticketly-vYYYY.MM.DD.N.tgz` with a SHA-256 checksum. This one artifact is
   what every environment receives — never rebuilt per environment.
3. **stage → uat → prod**, one after the other, each in its GitHub Environment:
   - the artifact's checksum and embedded commit are verified;
   - it is deployed to every host in the environment's `DEPLOY_HOSTS`, one
     host at a time, by `deploy/release.sh` (install, migrate, rolling
     restart behind health checks, automatic rollback on that host);
   - `APP_URL/health/ready` and `/health/live` are smoke-tested; on failure
     every host is rolled back and the release stops;
   - the environment branch is fast-forwarded to the commit — the branch is
     always what is live. A branch someone committed to directly stops the
     release instead of being overwritten.
4. **Release**: the commit is tagged `vYYYY.MM.DD.N` and a GitHub Release is
   published with generated notes and the artifact attached.

A failure at any environment stops the release there; later environments
keep running the previous version. One release runs at a time.

## 4. Configuration (repository admin, one time)

- *Settings → Actions → General → Workflow permissions*: allow GitHub Actions
  to create and approve pull requests (for the automatic approval; merging
  works without it).
- *Settings → Branches*: protect `main`, `stage`, `uat`, `prod`; require the
  **CI OK** check on `main`.
- *Settings → Environments* `stage`, `uat`, `prod` (created by the first run):
  - variables `DEPLOY_HOSTS` (`deploy@10.0.0.11 deploy@10.0.0.12`) and `APP_URL`;
  - secrets `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan` output);
  - optionally a required reviewer on `prod` for a manual gate.

  Until `DEPLOY_HOSTS` is set an environment is promoted (its branch moves)
  but nothing is deployed. Server setup: `docs/DEPLOYMENT.md`.

## 5. Rolling back

- Automatic: a failed health check (on a host) or smoke test (for the
  environment) rolls back to the previous release.
- By hand: `ssh deploy@host 'bash /opt/ticketly/current/deploy/release.sh rollback'`,
  or revert the commit with a PR — it rides the pipeline like any fix.

The database is never rolled back: migrations are backward compatible, so the
previous release runs on the migrated schema (expand → migrate → contract).

## 6. Dependencies

Dependabot opens grouped update PRs weekly (npm and GitHub Actions); they go
through CI and the pipeline like any other change.
