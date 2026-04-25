# Verified Upstream Registry

The upstream registry is the curated metadata layer for direct installs from trusted release sources.

Current status: the schema, parser, first GitHub Releases resolver, and resolved vendor URL cask resolver exist. Unsupported packages and resolver misses still fall back to Homebrew-compatible metadata. Records should only be added when the upstream source has an explicit trust boundary and a deterministic verification path.

The runtime registry has three sources, in order: a local cache file, the nanobrew GitHub registry metadata URL, and the embedded fallback compiled into `nb`. `src/upstream/registry_default.json` is still loaded with Zig `@embedFile`, parsed at runtime, and used whenever no valid cache or remote metadata can be loaded. A stale cache is refreshed from GitHub when possible, but can still be used if refresh fails. A "seeded" package means its trusted upstream record has been manually added to that embedded registry snapshot.

Use `scripts/discover-github-upstreams.mjs` to find Homebrew formula/cask records whose current download metadata is already GitHub-native. See `docs/github-upstream-discovery.md` for the first-pass counts and integration order.

Runtime status: cask records backed by GitHub Releases or resolved vendor URLs are now tried before the Homebrew cask API. Formula records backed by GitHub Releases are tried before the Homebrew formula API when they declare explicit binary artifacts. The embedded cask records are `1password`, `1password-cli`, `actual`, `alacritty`, `alt-tab`, `android-platform-tools`, `android-studio`, `antigravity`, `betterdisplay`, `bitwarden`, `brave-browser`, `bruno`, `cc-switch`, `chatgpt`, `claude`, `claude-code`, `claude-code@latest`, `cmux`, `codex-app`, `copilot-cli`, `cursor`, `dbeaver-community`, `discord`, `dockdoor`, `firefox`, `ghostty`, `github`, `google-chrome`, `hammerspoon`, `iina`, `iterm2`, `libreoffice`, `linearmouse`, `lm-studio`, `maccy`, `mitmproxy`, `ngrok`, `notion`, `obsidian`, `ollama-app`, `openclaw`, `opencode-desktop`, `rectangle`, `slack`, `stats`, `sublime-text`, `telegram`, `utm`, `vlc`, and `zed`; the embedded formula records are `gh`, `just`, `mise`, `ripgrep`, `uv`, `actionlint`, `atuin`, `fd`, `lazygit`, `podman`, `bat`, `chezmoi`, `fastfetch`, `git-delta`, `git-lfs`, `golangci-lint`, `k9s`, `llmfit`, `ruff`, and `zoxide`. Each record carries resolved `version + URL + sha256` metadata for the supported platforms. Casks hand the result to the existing native cask download/verify/install path, including direct binary downloads and archive-contained binary artifacts. Formula records use the source-archive path and only become installable when their registry record declares the binary paths to copy into the keg's `bin/`. If a GitHub release record does not have resolved metadata for the current platform, nanobrew can still use the GitHub latest-release API as a fallback resolver. Vendor URL records are resolved-only and fall back to Homebrew metadata if the current platform is not present. Set `NANOBREW_DISABLE_UPSTREAM=1` to force the Homebrew metadata path while debugging.

Remote registry loading uses `/opt/nanobrew/cache/api/upstream-registry.json` by default, with a six-hour freshness window. The default remote URL is `https://raw.githubusercontent.com/justrach/nanobrew/main/registry/upstream.json`. Set `NANOBREW_DISABLE_UPSTREAM_REGISTRY_REMOTE=1` to use only the cache plus embedded fallback, `NANOBREW_UPSTREAM_REGISTRY_CACHE=/path/to/upstream.json` to override the cache path, or `NANOBREW_UPSTREAM_REGISTRY_URL=https://...` to override the metadata URL.

Formula records also get a small per-token resolved metadata cache under `/opt/nanobrew/cache/api/upstream-formula-*.json`, keyed by the registry channel. This keeps warm reinstalls from reparsing the full hosted registry. Verified upstream binary formulae additionally save relocated keg snapshots keyed by their source SHA256 so they can use the same materialize-and-link path as cached Homebrew bottles.

Regular-user safety: `registry/upstream.json` on `main` is the stable registry channel because released binaries may fetch it without a binary update. Experimental resolver classes, broad top-N generated records, and unsoaked records should live behind an explicit `NANOBREW_UPSTREAM_REGISTRY_URL` beta URL until they pass verification, runtime checks, install benchmarks, and a beta-release soak. If a stable hosted record regresses, revert the hosted registry entry first; users can bypass immediately with `NANOBREW_DISABLE_UPSTREAM=1`.

## Top-100 Expansion Workflow

As of 2026-04-25, verified upstream coverage started from 11/100 Homebrew formulae and 18/100 Homebrew casks in the top-100 analytics sets. The current generated registry on this branch covers 11/100 formulae and 48/100 casks. Treat the 18/100 cask number as the baseline for the related #251-#256 work: any resolver-class or generated-record change should include a fresh coverage run and explain whether the delta comes from new records, analytics churn, or report logic.

Keep top-100 expansion methodical and serial:

1. Run coverage against the current registry before changing records.
2. Classify the uncovered top-100 gaps by resolver class and artifact shape.
3. Implement one resolver class, including parser/runtime support and generator support, before adding broad generated records for that class.
4. Generate records from the reviewed source rules.
5. Run a beta registry smoke test through `NANOBREW_UPSTREAM_REGISTRY_URL`.
6. Run an install benchmark against the same beta registry.
7. Apply the promotion gate.
8. Promote the accepted records to the stable registry channel.

Coverage comes first:

```sh
GITHUB_TOKEN="$(gh auth token)" scripts/upstream-coverage-report.mjs --top 100 --download-counts
```

For #255, classify every uncovered top-100 token before implementing a resolver class:

```sh
scripts/upstream-gap-report.mjs --top 100
scripts/upstream-gap-report.mjs --top 100 --json > /tmp/upstream-gaps.json
```

The gap report emits buckets such as existing `github_release`, resolved `vendor_url`, Homebrew bottle metadata, source-build formula support, binary rename support, pkg-only casks, font casks, tap analytics metadata, `no_check` verification policy, unsupported install behavior, or unsafe/no deterministic verification. Keep the JSON output with the issue or PR so resolver work can be prioritized from recorded data.

Implement and review one new resolver class at a time. The runtime resolver, registry schema changes, generated-record logic, fixtures, and fallback behavior should land together so a generated top-100 record cannot require behavior that `nb` does not understand yet. Existing GitHub-release formula and cask records can use the current seeders; new resolver classes should use the generator entrypoint added with that resolver.

After generating records, test them through a beta registry URL instead of the stable `registry/upstream.json` channel. From the repo root, start a local beta registry server:

```sh
python3 -m http.server 8765
```

In another shell, run the smoke checks against that beta URL:

```sh
zig build
NANOBREW_UPSTREAM_REGISTRY_URL=http://127.0.0.1:8765/registry/upstream.json \
  NANOBREW_UPSTREAM_REGISTRY_CACHE=/opt/nanobrew/cache/api/upstream-registry-beta-local.json \
  ./zig-out/bin/nb info <formula-token>
NANOBREW_UPSTREAM_REGISTRY_URL=http://127.0.0.1:8765/registry/upstream.json \
  NANOBREW_UPSTREAM_REGISTRY_CACHE=/opt/nanobrew/cache/api/upstream-registry-beta-local.json \
  ./zig-out/bin/nb info --cask <cask-token>
```

The beta smoke should cover at least one generated formula, one generated cask when the change touches casks, one token missing from the beta registry to prove fallback still works, and one malformed or unsupported generated record when the resolver class has new validation logic. If a dedicated smoke script is added later, it should preserve those checks.

Then measure the install path against the same beta registry:

```sh
scripts/bench-upstream-install.mjs --tokens <token-a>,<token-b> --iterations 1 --cold \
  --upstream-registry-url http://127.0.0.1:8765/registry/upstream.json \
  --upstream-registry-cache /opt/nanobrew/cache/api/upstream-registry-beta-local.json
```

The promotion gate is the last stop before stable. A record or resolver class passes only when coverage has been rerun, all top-100 additions have a documented classification, deterministic verification is present, fallback behavior is tested, generated records are reproducible, `zig build test-upstream-registry`, `zig build test-upstream-github`, and `zig build test` pass, beta `nb info` smoke passes, cold install benchmarks are recorded, and a beta/prerelease soak has not found regressions. Use `scripts/upstream-promotion-check.mjs` to make the coverage, registry, `no_check`, and benchmark parts explicit:

```sh
scripts/upstream-coverage-report.mjs --top 100 --json > /tmp/upstream-before.json
# Apply generated registry changes, then:
scripts/upstream-coverage-report.mjs --top 100 --json > /tmp/upstream-after.json
scripts/bench-upstream-install.mjs --tokens <token-a>,<token-b> --iterations 1 --cold --json > /tmp/upstream-bench.json
scripts/upstream-promotion-check.mjs \
  --before-json /tmp/upstream-before.json \
  --after-json /tmp/upstream-after.json \
  --bench-json /tmp/upstream-bench.json \
  --min-speedup 1
```

Pass `--allow-no-check` only when the record includes an explicit `verification.no_check_reason` and the PR explains why checksum pinning is impossible or not meaningful for that source.

Promote stable only after the gate passes. Promotion means moving accepted records from the beta/generated candidate set into the stable hosted `registry/upstream.json` channel and, while the embedded fallback still exists, mirroring the same accepted records into `src/upstream/registry_default.json` in the integration branch. Re-run coverage after promotion and record the new top-100 formula/cask counts next to the 2026-04-25 baseline.

Offline tooling fixtures cover coverage math, gap classification, release DB generation, and promotion gating:

```sh
node scripts/test-upstream-tooling.mjs
```

Use `scripts/build-upstream-release-db.mjs` after a record exists in `registry/upstream.json` to build a local review database of GitHub releases, assets, asset digests, and repository advisories. The default output is `registry/upstream-release-db.json`, which is ignored by git because it is generated review data, not runtime state.

Use `scripts/seed-upstream-formulas.mjs` to find popular formula candidates programmatically from Homebrew's 30-day install-on-request analytics. The seeder only writes formula records when it can find a GitHub latest release, a macOS arm64 archive with a GitHub SHA256 asset digest, and an inferable binary path inside that archive. Archive inspection has download timeouts and a size cap so broad scans skip unsuitable payloads instead of hanging. It mirrors generated records into both `registry/upstream.json` and `src/upstream/registry_default.json` when run with `--write`.

```sh
GITHUB_TOKEN="$(gh auth token)" scripts/seed-upstream-formulas.mjs --limit 5 --scan 300 --write
```

Use `scripts/seed-upstream-casks.mjs` to find popular cask candidates programmatically from Homebrew's 30-day cask install analytics. The cask seeder writes GitHub Release records when it can find a supported macOS asset and GitHub SHA256 asset digest, and writes resolved vendor URL records when Homebrew has pinned URL/SHA256 metadata for a native format that nanobrew can install. It supports app artifacts, direct binary downloads, binary-only casks, Caskroom-relative binary paths, and binary target renames. It skips artifact shapes the registry or runtime cannot represent without losing install behavior, such as app rename targets, platform-specific artifact paths, pkg installs unless `--include-pkg` is explicitly used, installer scripts, suites, completions, fonts, and app endpoints whose actual archive format is hidden behind an extensionless URL.

```sh
GITHUB_TOKEN="$(gh auth token)" scripts/seed-upstream-casks.mjs --limit 10 --scan 300 --write
```

Use `scripts/upstream-coverage-report.mjs` to measure the current verified registry against Homebrew popularity analytics. Homebrew analytics are the primary prioritization signal; GitHub release asset `download_count` is also available with `--download-counts`, but it is a lifetime counter for a release asset and not equivalent to Homebrew installs.

```sh
GITHUB_TOKEN="$(gh auth token)" scripts/upstream-coverage-report.mjs --top 100 --download-counts
```

The current seeders are intentionally conservative and do not imply that the top 100 can be fully covered by the current registry shape alone. A broad dry run with `--include-existing --scan 100 --limit 100` reports the current ceiling for the implemented resolver classes. Reaching full top-100 coverage requires adding more source classes and artifact shapes, such as Homebrew bottle metadata for formulae, source-build formula support, extensionless app download format probes, platform-specific cask artifact rules, pkg-only casks, suite casks, installer-script casks, font casks, tap analytics metadata, and casks whose verification policy is `no_check`.

Use `scripts/bench-upstream-install.mjs` to measure the actual install path, not only metadata lookup. For formulae, this times dependency resolution, download, verification, extraction, upstream binary install or Homebrew bottle materialization, relocation, linking, and cleanup between runs. The script refuses packages that were already installed before the run, so it does not silently remove a user's existing packages. Use `--cold` to purge package-specific blob/store/tmp cache entries before each timed install. Use `--upstream-registry-url` and `--upstream-registry-cache` to test an opt-in beta registry without touching the stable registry cache.

```sh
scripts/bench-upstream-install.mjs --tokens actionlint,fd --iterations 1 --cold
scripts/bench-upstream-install.mjs --tokens actionlint,fd --iterations 1 \
  --upstream-registry-url http://127.0.0.1:8765/registry/upstream.json \
  --upstream-registry-cache /opt/nanobrew/cache/api/upstream-registry-beta-local.json
```

Use `scripts/bench-upstream-resolution.mjs` to measure metadata lookup speed for seeded records through `nb info`. It compares verified upstream metadata against the Homebrew fallback path and does not download or install payloads.

```sh
zig build
scripts/bench-upstream-resolution.mjs --tokens gh,uv,bat,obsidian,rectangle --iterations 5
```

Generator changes can be tested without GitHub:

```sh
scripts/build-upstream-release-db.mjs --self-test
```

The self-test reads `tests/fixtures/upstream-release-db` and fails if the generator attempts a network fetch. To inspect fixture-backed output directly, run:

```sh
scripts/build-upstream-release-db.mjs \
  --registry tests/fixtures/upstream-release-db/registry.json \
  --fixture-dir tests/fixtures/upstream-release-db \
  --stdout
```

Fixture files are named `<owner>__<repo>.releases.json` and `<owner>__<repo>.advisories.json`. They should contain raw GitHub API-shaped arrays so the same normalization path is exercised as a live refresh.

Required record fields:

- `token`: nanobrew package or cask token.
- `kind`: `formula` or `cask`.
- `upstream`: source descriptor.
- `verification`: checksum, signature, or attestation policy.

For `github_release` upstreams, `repo` is the `owner/name` allowlist. For `vendor_url` upstreams, `allow_domains` must list the allowed download domains.

Formula records must define at least one `assets` entry keyed by platform, such as `macos-arm64`, `macos-x86_64`, `linux-x86_64`, or `linux-aarch64`. Cask records must define at least one artifact declaration.

For GitHub release casks, `assets` is also required. Asset patterns support `{tag}`, `{version}`, and `*`. `{version}` is the release tag with a leading `v` stripped when the tag is version-like.

Hot-path records should also include `resolved` metadata:

```json
{
  "resolved": {
    "tag": "v10.12.0",
    "version": "10.12.0",
    "assets": {
      "macos-arm64": {
        "url": "https://github.com/lwouis/alt-tab-macos/releases/download/v10.12.0/AltTab-10.12.0.zip",
        "sha256": "e7aea75cf1dd30dba6b5a9ef50da03f389bc5db74089e67af9112938a4192c14"
      }
    },
    "security_warnings": [
      {
        "ghsa_id": "GHSA-xxxx-yyyy-zzzz",
        "cve_id": "CVE-2026-0001",
        "severity": "high",
        "summary": "Example advisory affecting older releases",
        "url": "https://github.com/owner/project/security/advisories/GHSA-xxxx-yyyy-zzzz",
        "affected_versions": "< 10.12.1",
        "patched_versions": ">= 10.12.1"
      }
    ]
  }
}
```

This mirrors Homebrew's split: metadata lookup yields URL and checksum, while artifact download and verification happen later in the installer.

## Scaling The Update Path

The scalable shape is a two-layer registry:

1. Curated source records: token, upstream repo or domain allowlist, platform asset rules, artifact install rules, and verification policy.
2. Generated resolved snapshot: release tag, version, per-platform URL/SHA256, and any advisory warnings that apply to that resolved version.

The current `registry/upstream.json` keeps both layers together while the feature is small. As the registry grows, split it into a hand-reviewed source file and a generated lock snapshot. The `nb` runtime should keep using the generated embedded snapshot, so `nb info --cask` and `nb install --cask` do not need Homebrew metadata or GitHub metadata calls for seeded records.

A refresh job should:

1. Read curated source records.
2. Fetch GitHub release metadata for each allowlisted repo, using conditional requests and a `GITHUB_TOKEN` for rate limits.
3. Render each platform asset pattern against the release tag/version.
4. Require a GitHub release asset digest or an accepted checksum sidecar before writing the resolved asset.
5. Fetch GitHub repository security advisories for the same repo.
6. Normalize applicable advisories into `resolved.security_warnings`.
7. Emit a deterministic JSON snapshot and fail the refresh if a previously seeded platform loses a valid asset or checksum.

GitHub release objects expose assets with `browser_download_url` and `digest` fields. GitHub security advisories are not embedded inside release objects; repository advisories come from the repository security advisories API. Nanobrew should join those data sources during refresh and inline the normalized warning data into the generated snapshot.

`resolved.security_warnings` is advisory display metadata. Runtime install behavior should remain checksum-driven: warnings are printed, but verification and download safety still come from the resolved URL/SHA256 policy. Advisory filtering should happen in the refresh job so the hot path does not need a semver/range engine.

For now, promotion can stay manual:

1. Add or edit a source record in `registry/upstream.json` with the trusted repo, platform asset patterns, artifacts, and verification policy.
2. Run `scripts/build-upstream-release-db.mjs --token <token> --release-limit 5`. Omit `--fixture-dir` for real promotion data.
3. Inspect `registry/upstream-release-db.json`, especially `latest_candidate`, matched asset names, SHA256 digests, `latest_candidate.missing`, and `advisories`.
4. Copy `latest_candidate.manual_resolved_snippet` into the record's `resolved` field only when `latest_candidate.status` is `resolved` and the assets and digests are correct.
5. Manually curate any applicable advisory entries into `resolved.security_warnings`.
6. Mirror the promoted record into `src/upstream/registry_default.json` until the source/lock split is implemented.
7. Run `zig build test-upstream-registry`, `zig build test-upstream-github`, `zig build test`, and `./zig-out/bin/nb info --cask <token>`.

For broad crawls, set `GITHUB_TOKEN` first. Without it, GitHub's unauthenticated API limit can produce `rate_limited` release or advisory statuses in the generated DB.

Example:

```json
{
  "schema_version": 1,
  "records": [
    {
      "token": "example-tool",
      "kind": "formula",
      "upstream": {
        "type": "github_release",
        "repo": "owner/example-tool",
        "verified": true
      },
      "assets": {
        "macos-arm64": {
          "pattern": "example-tool-{version}-aarch64-apple-darwin.tar.gz",
          "strip_components": 1
        }
      },
      "verification": {
        "sha256": "asset_digest",
        "signature": "optional",
        "attestation": "optional"
      }
    }
  ]
}
```
