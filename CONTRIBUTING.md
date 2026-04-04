# Contributing

Thanks for contributing to nanobrew.

This codebase moves quickly across Zig runtime code, packaging logic, platform-specific install flows, and CI. Small, current, issue-linked PRs are much easier to review and much less likely to regress behavior.

## Ground Rules

1. Every PR must be tied to an issue.
2. Rebase onto current `main` before requesting final review.
3. Keep PRs tightly scoped.
4. Do not commit generated artifacts.
5. Do not mix unrelated refactors, lockfile churn, or docs rewrites into a bug-fix PR.

If a branch goes stale, close it and open a smaller replacement instead of accreting more changes onto the old PR.

## PR Requirements

Every PR description should include:

- linked issue number
- summary of the exact change
- files or subsystems touched
- tests run
- failing test, xfail, or exact repro that demonstrated the problem before the fix
- passing rerun of that same test or repro after the fix
- nearby non-regression checks proving the change did not just move the bug
- whether the branch was rebased onto current `main`
- whether any generated files or CI wiring changed
- explicit confirmation that the submission matches `CONTRIBUTING.md`

If a PR does not map cleanly to an issue, open the issue first.

## Red-To-Green Rule

For bug fixes, compatibility fixes, runtime fixes, security fixes, and regressions:

1. show the failing test, xfail, or exact repro first
2. make the code change
3. rerun the same test or repro and show it passing
4. run the closest neighboring tests to prove the fix did not just move the bug

If there is no failing test yet, write one first unless the failure is impossible to encode cleanly.

Acceptable proof in a PR:

- `before`: exact failing `zig build test`, shell repro, or install command
- `after`: the same command rerun cleanly
- nearby guard: the closest relevant module, platform, or regression test still passing

## Scope Rules

Good PR scope:

- one bug fix
- one small security hardening change
- one compatibility fix
- one docs-only clarification

Bad PR scope:

- runtime change plus unrelated refactor
- security fix plus dependency churn
- feature work plus generated artifacts
- multiple unrelated bug fixes bundled together

If a reviewer cannot explain the PR in one sentence, it is probably too large.

Default rule: keep each PR under 500 changed lines total. PRs over 500 changed lines will usually be rejected unless they are clearly justified, tightly scoped, and good enough to survive strict review. If a larger PR is unavoidable, call that out explicitly in the PR body and explain why it was not split.

## Rebase Policy

Before requesting review on any non-trivial PR:

```bash
git fetch origin
git rebase origin/main
```

Why this matters:

- stale cleanup PRs can delete code that is no longer dead
- stale bug-fix PRs often miss newer behavior in `main`
- stale security PRs become hard to reason about

If rebasing reveals unrelated conflicts, split the PR.

## CI Before Review

For runtime, compatibility, packaging, service, security, and perf-sensitive changes, run the narrowest relevant local checks before requesting review and include the commands and results in the PR body.

At minimum:

- the exact failing repro or test from before the fix
- the passing rerun after the fix
- the closest neighboring non-regression checks

If the branch changes behavior that normally goes through GitHub Actions, do not request final review until branch CI is green or any remaining failures are clearly explained in the PR description.

## Generated Files

Do not commit generated or local-build artifacts, including:

- `.zig-cache/`
- `zig-out/`
- compiled `.dylib`, `.so`, `.o`, or temp binaries
- local logs or benchmark artifacts unless the PR is explicitly about publishing benchmark evidence

If a file is generated during local builds, update `.gitignore` instead of committing it.

## Tests

At minimum, run the narrowest relevant tests for the code you changed.

Examples:

```bash
zig build test
zig build linux
tests/linux-relocation-failure.sh
```

For fixes, do not just say "tests passed".

Show:

- the failing command before the fix
- the passing command after the fix
- at least one neighboring or regression-guard command

## Review Expectations

Reviewers will push back on:

- stale branches
- unrelated file churn
- generated artifacts
- oversized PRs
- missing issue links
- claims that do not match the changed code
- PRs that do not follow this file

That is process, not hostility.
