# Release process

Four long-lived branches, one direction of travel:

```
feature / fix branch ──PR──▶ main ──▶ stage ──▶ uat ──▶ prod
```

1. **Every change is its own pull request into `main`** — one feature or one
   bug fix per branch (`feat/...`, `fix/...`), never a mix.
2. **CI** (`.github/workflows/ci.yml`) runs on the PR: format, lint, typecheck,
   migrations against Postgres, unit + architecture tests, end-to-end tests.
3. **When CI passes, the PR is approved and squash-merged automatically**
   (`.github/workflows/pipeline.yml`) and its branch is deleted.
4. **The merged commit is promoted automatically**: `main` → `stage` → `uat` →
   `prod`, one environment job after the other (`.github/workflows/promote.yml`),
   each running in the GitHub Environment of the same name:
   - the exact commit is verified again (install, typecheck, unit tests);
   - the environment branch is fast-forwarded to it — never force-pushed: if
     one has diverged (someone committed to it directly), the release stops
     there with an error instead of overwriting it;
   - it is deployed, when that environment has a `DEPLOY_WEBHOOK_URL` secret
     (a POST of `{environment, branch, commit}`; the hosting platform pulls
     the branch). Without the secret the branch is still promoted.

   A failure at `stage` stops the release before `uat` and `prod`. Each run
   is listed under the repository's *Environments / Deployments*; a manual
   gate (required reviewer) can be added per environment in *Settings →
   Environments* at any time without changing the workflows.

Never commit to `stage`, `uat` or `prod` directly; a hot fix is a normal PR
into `main` and rides the same pipeline.

One repository setting is needed for step 3's approval (merging works
without it): *Settings → Actions → General → Workflow permissions → "Allow
GitHub Actions to create and approve pull requests"*.
