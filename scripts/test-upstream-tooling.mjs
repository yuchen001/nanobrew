#!/usr/bin/env node

/*
Lightweight offline fixture checks for upstream registry tooling.

Intended assertions:
- Gap reporting should rank top unseeded formula/cask fixtures ahead of lower-signal
  unseeded rows while preserving deterministic coverage math from local analytics.
- Promotion checks should distinguish a resolvable GitHub release candidate from a
  candidate that is blocked by missing assets or missing sha256 digests.
- Promotion checks should skip prereleases by default and surface advisory metadata
  for manual review without requiring network access.

Run:
  node --check scripts/test-upstream-tooling.mjs
  node scripts/test-upstream-tooling.mjs
*/

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURE_DIR = join(SCRIPT_DIR, "fixtures", "upstream");

function fixturePath(...parts) {
  return join(FIXTURE_DIR, ...parts);
}

async function runNode(args) {
  const { stdout } = await execFile(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      GITHUB_TOKEN: "",
    },
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function readCoverageReport() {
  const stdout = await runNode([
    "scripts/upstream-coverage-report.mjs",
    "--registry",
    fixturePath("coverage-registry.json"),
    "--formula-analytics-file",
    fixturePath("formula-analytics.json"),
    "--cask-analytics-file",
    fixturePath("cask-analytics.json"),
    "--top",
    "4",
    "--json",
  ]);
  return JSON.parse(stdout);
}

async function readGapReport() {
  const stdout = await runNode([
    "scripts/upstream-gap-report.mjs",
    "--registry",
    fixturePath("coverage-registry.json"),
    "--formula-analytics-file",
    fixturePath("formula-analytics.json"),
    "--cask-analytics-file",
    fixturePath("cask-analytics.json"),
    "--formula-file",
    fixturePath("formula-metadata.json"),
    "--cask-file",
    fixturePath("cask-metadata.json"),
    "--top",
    "4",
    "--json",
  ]);
  return JSON.parse(stdout);
}

async function readPromotionDatabase() {
  const stdout = await runNode([
    "scripts/build-upstream-release-db.mjs",
    "--registry",
    fixturePath("promotion-registry.json"),
    "--fixture-dir",
    fixturePath("github"),
    "--release-limit",
    "5",
    "--stdout",
  ]);
  return JSON.parse(stdout);
}

async function readPromotionCheck() {
  const stdout = await runNode([
    "scripts/upstream-promotion-check.mjs",
    "--registry",
    fixturePath("promotion-check-registry.json"),
    "--before-json",
    fixturePath("promotion-check-before.json"),
    "--after-json",
    fixturePath("promotion-check-after.json"),
    "--bench-json",
    fixturePath("bench-install.json"),
    "--min-formula-new",
    "1",
    "--min-cask-new",
    "1",
    "--min-speedup",
    "1.1",
    "--json",
  ]);
  return JSON.parse(stdout);
}

function assertCoverage(report) {
  assert.equal(report.registry, fixturePath("coverage-registry.json"));
  assert.equal(report.top, 4);

  assert.equal(report.formula.seeded_records, 2);
  assert.equal(report.formula.top_total_records, 4);
  assert.equal(report.formula.top_seeded_records, 2);
  assert.equal(report.formula.top_total_30d_count, 2100);
  assert.equal(report.formula.top_seeded_30d_count, 1250);
  assert.equal(report.formula.top_coverage_percent, 59.52);
  assert.deepEqual(
    report.formula.top_unseeded.map((item) => item.token),
    ["fixture-gap-formula", "fixture-low-signal-formula"],
  );

  assert.equal(report.cask.seeded_records, 2);
  assert.equal(report.cask.top_total_records, 4);
  assert.equal(report.cask.top_seeded_records, 2);
  assert.equal(report.cask.top_total_30d_count, 1900);
  assert.equal(report.cask.top_seeded_30d_count, 900);
  assert.equal(report.cask.top_coverage_percent, 47.37);
  assert.deepEqual(
    report.cask.top_unseeded.map((item) => item.token),
    ["fixture-gap-cask", "fixture-unseeded-cask"],
  );
}

function assertGapReport(report) {
  assert.equal(report.registry, fixturePath("coverage-registry.json"));
  assert.equal(report.top, 4);

  assert.equal(report.summary.formula.top_seeded_records, 2);
  assert.equal(report.summary.formula.top_gap_records, 2);
  assert.deepEqual(
    report.formula.gaps.map((item) => item.token),
    ["fixture-gap-formula", "fixture-low-signal-formula"],
  );
  assert.deepEqual(
    report.formula.gaps.map((item) => item.resolver_class),
    ["github_source_build", "vendor_source_build"],
  );
  assert.deepEqual(
    report.formula.gaps.map((item) => item.current_seeder.status),
    ["probe_required", "skipped"],
  );

  assert.equal(report.summary.cask.top_seeded_records, 2);
  assert.equal(report.summary.cask.top_gap_records, 2);
  assert.deepEqual(
    report.cask.gaps.map((item) => item.token),
    ["fixture-gap-cask", "fixture-unseeded-cask"],
  );
  assert.deepEqual(
    report.cask.gaps.map((item) => item.resolver_class),
    ["app_cask", "package_manager_cli"],
  );
}

function assertPromotionDatabase(db) {
  assert.equal(db.source_registry, fixturePath("promotion-registry.json"));
  assert.equal(db.release_limit, 5);
  assert.equal(db.include_prerelease, false);
  assert.equal(db.advisory_fetch, "enabled");
  assert.equal(db.record_count, 2);

  const records = new Map(db.records.map((record) => [record.token, record]));
  const promotable = records.get("fixture-promotable");
  assert.ok(promotable, "fixture-promotable record is present");
  assert.equal(promotable.release_status, "ok");
  assert.equal(promotable.advisory_status, "ok");
  assert.equal(promotable.current_resolved.tag, "v1.0.0");
  assert.equal(promotable.latest_candidate.status, "resolved");
  assert.equal(promotable.latest_candidate.tag, "v1.1.0");
  assert.equal(promotable.latest_candidate.version, "1.1.0");
  assert.equal(promotable.latest_candidate.advisory_review_count, 1);
  assert.equal(
    promotable.latest_candidate.assets["macos-arm64"].sha256,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(
    promotable.latest_candidate.assets["macos-x86_64"].sha256,
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  assert.deepEqual(
    Object.keys(promotable.latest_candidate.manual_resolved_snippet.assets),
    ["macos-arm64", "macos-x86_64"],
  );
  assert.equal(promotable.advisories[0].ghsa_id, "GHSA-prom-0001-test");
  assert.equal(promotable.advisories[0].cve_id, "CVE-2026-1001");
  assert.equal(promotable.advisories[0].affected_versions, "< 1.1.0");
  assert.equal(promotable.advisories[0].patched_versions, ">= 1.1.0");

  const gap = records.get("fixture-promotion-gap");
  assert.ok(gap, "fixture-promotion-gap record is present");
  assert.equal(gap.release_status, "ok");
  assert.equal(gap.advisory_status, "ok");
  assert.equal(gap.latest_candidate.status, "incomplete");
  assert.equal(gap.latest_candidate.manual_resolved_snippet, null);
  assert.deepEqual(
    gap.latest_candidate.missing.map((missing) => `${missing.platform}:${missing.reason}`),
    ["macos-arm64:missing_sha256_digest", "macos-x86_64:missing_asset"],
  );
}

function assertPromotionCheck(check) {
  assert.equal(check.ok, true);
  assert.equal(check.coverage.status, "pass");
  assert.equal(check.coverage.formula.new_records, 1);
  assert.equal(check.coverage.cask.new_records, 1);
  assert.equal(check.registry_checks.status, "pass");
  assert.deepEqual(check.registry_checks.new_records.formula, ["fixture-new-formula"]);
  assert.deepEqual(check.registry_checks.new_records.cask, ["fixture-new-cask"]);
  assert.equal(check.benchmarks.status, "pass");
  assert.equal(check.benchmarks.files[0].rows[0].token, "fixture-new-formula");
  assert.equal(check.benchmarks.files[0].rows[0].speedup, 1.8);
}

async function main() {
  assertCoverage(await readCoverageReport());
  assertGapReport(await readGapReport());
  assertPromotionDatabase(await readPromotionDatabase());
  assertPromotionCheck(await readPromotionCheck());
  console.log("upstream tooling fixture checks passed");
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
