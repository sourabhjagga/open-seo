#!/usr/bin/env bash
# Reconcile .github/workflows after an upstream merge.
#
# OpenSEO keeps fork-owned workflows (upstream-sync.yml, deploy-verify.yml) plus
# pr-preview.yml (required by src/lib/pr-preview-access.test.ts). Every other
# upstream workflow (ci, build-matrix, release, gitbook-pages, and any new ones
# upstream adds later) is removed so they never run on the fork and never conflict.
#
# Called by .github/workflows/upstream-sync.yml after `git merge`.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

shopt -s nullglob
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  base="$(basename "$f")"
  case "$base" in
    upstream-sync.yml|deploy-verify.yml|pr-preview.yml) ;;   # keep: fork-owned + upstream test dependency
    *) git rm -f -- "$f" ;;
  esac
done

echo "Workflow reconciliation done. Remaining:"
ls .github/workflows/ 2>/dev/null || true
