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
   `prod`, in that order, by fast-forward only. An environment branch never
   receives a commit that did not pass CI on `main`, and is never rewritten: if
   one has diverged (someone committed to it directly), the promotion stops
   with an error instead of overwriting it.

Never commit to `stage`, `uat` or `prod` directly; a hot fix is a normal PR
into `main` and rides the same pipeline.

One repository setting is needed for step 3's approval (merging works
without it): *Settings → Actions → General → Workflow permissions → "Allow
GitHub Actions to create and approve pull requests"*.
