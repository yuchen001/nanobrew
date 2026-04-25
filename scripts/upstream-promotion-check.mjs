#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const DEFAULT_REGISTRY = "registry/upstream.json";
const DEFAULT_TOP = 100;
const DEFAULT_COVERAGE_TIMEOUT_MS = 45_000;

function parseArgs(argv) {
  const opts = {
    registry: DEFAULT_REGISTRY,
    top: DEFAULT_TOP,
    beforeJson: null,
    afterJson: null,
    minFormulaNew: 0,
    minCaskNew: 0,
    allowNoCheck: false,
    benchJson: [],
    minSpeedup: 1,
    allowBenchmarkSkips: false,
    formulaAnalyticsFile: null,
    caskAnalyticsFile: null,
    coverageTimeoutMs: DEFAULT_COVERAGE_TIMEOUT_MS,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--registry") {
      opts.registry = argv[++i] ?? "";
    } else if (arg.startsWith("--registry=")) {
      opts.registry = arg.slice("--registry=".length);
    } else if (arg === "--top") {
      opts.top = parsePositiveInteger(argv[++i], "--top");
    } else if (arg.startsWith("--top=")) {
      opts.top = parsePositiveInteger(arg.slice("--top=".length), "--top");
    } else if (arg === "--before-json") {
      opts.beforeJson = argv[++i] ?? "";
    } else if (arg.startsWith("--before-json=")) {
      opts.beforeJson = arg.slice("--before-json=".length);
    } else if (arg === "--after-json") {
      opts.afterJson = argv[++i] ?? "";
    } else if (arg.startsWith("--after-json=")) {
      opts.afterJson = arg.slice("--after-json=".length);
    } else if (arg === "--min-formula-new") {
      opts.minFormulaNew = parseNonNegativeInteger(argv[++i], "--min-formula-new");
    } else if (arg.startsWith("--min-formula-new=")) {
      opts.minFormulaNew = parseNonNegativeInteger(arg.slice("--min-formula-new=".length), "--min-formula-new");
    } else if (arg === "--min-cask-new") {
      opts.minCaskNew = parseNonNegativeInteger(argv[++i], "--min-cask-new");
    } else if (arg.startsWith("--min-cask-new=")) {
      opts.minCaskNew = parseNonNegativeInteger(arg.slice("--min-cask-new=".length), "--min-cask-new");
    } else if (arg === "--allow-no-check") {
      opts.allowNoCheck = true;
    } else if (arg === "--bench-json") {
      opts.benchJson.push(argv[++i] ?? "");
    } else if (arg.startsWith("--bench-json=")) {
      opts.benchJson.push(arg.slice("--bench-json=".length));
    } else if (arg === "--min-speedup") {
      opts.minSpeedup = parseNonNegativeNumber(argv[++i], "--min-speedup");
    } else if (arg.startsWith("--min-speedup=")) {
      opts.minSpeedup = parseNonNegativeNumber(arg.slice("--min-speedup=".length), "--min-speedup");
    } else if (arg === "--allow-benchmark-skips") {
      opts.allowBenchmarkSkips = true;
    } else if (arg === "--formula-analytics-file") {
      opts.formulaAnalyticsFile = argv[++i] ?? "";
    } else if (arg.startsWith("--formula-analytics-file=")) {
      opts.formulaAnalyticsFile = arg.slice("--formula-analytics-file=".length);
    } else if (arg === "--cask-analytics-file") {
      opts.caskAnalyticsFile = argv[++i] ?? "";
    } else if (arg.startsWith("--cask-analytics-file=")) {
      opts.caskAnalyticsFile = arg.slice("--cask-analytics-file=".length);
    } else if (arg === "--coverage-timeout-ms") {
      opts.coverageTimeoutMs = parsePositiveInteger(argv[++i], "--coverage-timeout-ms");
    } else if (arg.startsWith("--coverage-timeout-ms=")) {
      opts.coverageTimeoutMs = parsePositiveInteger(arg.slice("--coverage-timeout-ms=".length), "--coverage-timeout-ms");
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "-h" || arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(1);
    }
  }

  if (!opts.registry) die("--registry must not be empty");
  if (opts.beforeJson === "") die("--before-json must not be empty");
  if (opts.afterJson === "") die("--after-json must not be empty");
  if (opts.formulaAnalyticsFile === "") die("--formula-analytics-file must not be empty");
  if (opts.caskAnalyticsFile === "") die("--cask-analytics-file must not be empty");
  if (opts.benchJson.some((path) => !path)) die("--bench-json must not be empty");
  return opts;
}

function usage(code) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`Usage: scripts/upstream-promotion-check.mjs [options]

Gate upstream registry promotion coverage, registry verification, and saved install benchmarks.

Options:
  --registry PATH              Registry to check (default: ${DEFAULT_REGISTRY})
  --top N                      Popular rows used by coverage math (default: ${DEFAULT_TOP})
  --before-json PATH           Saved upstream-coverage-report --json output before the batch
  --after-json PATH            Saved upstream-coverage-report --json output after the batch
                               (default: invoke scripts/upstream-coverage-report.mjs)
  --formula-analytics-file P   Pass through when computing the after coverage report
  --cask-analytics-file P      Pass through when computing the after coverage report
  --coverage-timeout-ms N      Timeout for computed after coverage (default: ${DEFAULT_COVERAGE_TIMEOUT_MS})
  --min-formula-new N          Minimum new formula records versus --before-json (default: 0)
  --min-cask-new N             Minimum new cask records versus --before-json (default: 0)
  --allow-no-check             Allow new no_check checksum records when they include no_check_reason
  --bench-json PATH            Saved bench-upstream-install --json output to gate (repeatable)
  --min-speedup N              Minimum upstream speedup in benchmark JSON files (default: 1)
  --allow-benchmark-skips      Do not fail when benchmark JSON includes skipped tokens
  --json                       Emit machine-readable JSON instead of the human summary
  -h, --help                   Show this help

By default the script prints a concise human summary and exits non-zero on gate failure.
`);
  process.exit(code);
}

function die(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [registry, beforeReport, afterReport, benchmarks] = await Promise.all([
    readJson(opts.registry),
    opts.beforeJson ? readJson(opts.beforeJson) : null,
    opts.afterJson ? readJson(opts.afterJson) : computeAfterCoverage(opts),
    checkBenchmarks(opts),
  ]);

  const coverage = compareCoverage(beforeReport, afterReport, opts);
  const registryChecks = checkRegistry(registry, beforeReport, opts);
  const failures = [
    ...coverage.failures.map((message) => `coverage: ${message}`),
    ...registryChecks.failures.map((failure) => `registry: ${failure.message}`),
    ...benchmarks.failures.map((message) => `benchmark: ${message}`),
  ];

  const result = {
    ok: failures.length === 0,
    generated_at: new Date().toISOString(),
    registry: opts.registry,
    top: afterReport?.top ?? opts.top,
    coverage,
    registry_checks: registryChecks,
    benchmarks,
    failures,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(result);
  }
  process.exitCode = result.ok ? 0 : 1;
}

async function computeAfterCoverage(opts) {
  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "upstream-coverage-report.mjs");
  const args = [
    scriptPath,
    "--registry", opts.registry,
    "--top", String(opts.top),
    "--json",
  ];
  if (opts.formulaAnalyticsFile) {
    args.push("--formula-analytics-file", opts.formulaAnalyticsFile);
  }
  if (opts.caskAnalyticsFile) {
    args.push("--cask-analytics-file", opts.caskAnalyticsFile);
  }

  const result = await run(process.execPath, args, opts.coverageTimeoutMs);
  if (result.code !== 0) {
    throw new Error(`after coverage report failed: ${result.stderr || result.stdout}`);
  }
  return parseJson(result.stdout, "computed after coverage report");
}

function compareCoverage(beforeReport, afterReport, opts) {
  const failures = [];
  const warnings = [];
  const formula = compareKindCoverage("formula", beforeReport, afterReport, opts.minFormulaNew, failures);
  const cask = compareKindCoverage("cask", beforeReport, afterReport, opts.minCaskNew, failures);

  if (!beforeReport) {
    if (opts.minFormulaNew > 0 || opts.minCaskNew > 0) {
      failures.push("--before-json is required when minimum new-record thresholds are non-zero");
    }
    return {
      status: failures.length === 0 ? "skipped" : "fail",
      reason: "--before-json not supplied",
      before_json: null,
      after_json: opts.afterJson,
      computed_after: !opts.afterJson,
      thresholds: {
        min_formula_new: opts.minFormulaNew,
        min_cask_new: opts.minCaskNew,
      },
      formula,
      cask,
      warnings,
      failures,
    };
  }

  if (beforeReport.top != null && afterReport.top != null && beforeReport.top !== afterReport.top) {
    failures.push(`coverage reports use different top values (${beforeReport.top} before, ${afterReport.top} after)`);
  }

  return {
    status: failures.length === 0 ? "pass" : "fail",
    before_json: opts.beforeJson,
    after_json: opts.afterJson,
    computed_after: !opts.afterJson,
    thresholds: {
      min_formula_new: opts.minFormulaNew,
      min_cask_new: opts.minCaskNew,
    },
    formula,
    cask,
    warnings,
    failures,
  };
}

function compareKindCoverage(kind, beforeReport, afterReport, minNew, failures) {
  const before = beforeReport?.[kind] ?? null;
  const after = afterReport?.[kind] ?? null;
  const label = kind === "formula" ? "formula" : "cask";
  const row = {
    before_seeded_records: numberOrZero(before?.seeded_records),
    after_seeded_records: numberOrZero(after?.seeded_records),
    new_records: numberOrZero(after?.seeded_records) - numberOrZero(before?.seeded_records),
    before_top_seeded_records: numberOrZero(before?.top_seeded_records),
    after_top_seeded_records: numberOrZero(after?.top_seeded_records),
    new_top_records: numberOrZero(after?.top_seeded_records) - numberOrZero(before?.top_seeded_records),
    before_top_coverage_percent: numberOrZero(before?.top_coverage_percent),
    after_top_coverage_percent: numberOrZero(after?.top_coverage_percent),
    top_coverage_point_delta: round2(numberOrZero(after?.top_coverage_percent) - numberOrZero(before?.top_coverage_percent)),
    min_new_records: minNew,
  };

  if (beforeReport && !before) failures.push(`before coverage is missing ${label} data`);
  if (!after) failures.push(`after coverage is missing ${label} data`);
  if (beforeReport && row.new_records < 0) {
    failures.push(`${label} seeded records decreased (${row.before_seeded_records} -> ${row.after_seeded_records})`);
  }
  if (beforeReport && row.new_records < minNew) {
    failures.push(`${label} new records ${row.new_records} is below threshold ${minNew}`);
  }
  return row;
}

function checkRegistry(registry, beforeReport, opts) {
  const failures = [];
  const warnings = [];
  const records = Array.isArray(registry?.records) ? registry.records : [];
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    failures.push(failure(null, null, "registry root must be an object"));
  }
  if (!Array.isArray(registry?.records)) {
    failures.push(failure(null, null, "registry.records must be an array"));
  }
  if (!Number.isInteger(registry?.schema_version)) {
    failures.push(failure(null, null, "registry.schema_version must be an integer"));
  }

  const baseline = beforeReport ? tokensByKindFromCoverage(beforeReport) : null;
  const baselineUsable = baseline && (baseline.formula.size > 0 || baseline.cask.size > 0);
  const seen = new Map();
  const newRecords = { formula: [], cask: [] };
  const checkedTokens = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const kind = record?.kind;
    const token = record?.token;
    const recordKey = typeof kind === "string" && typeof token === "string" ? `${kind}:${token}` : `#${index + 1}`;
    if (seen.has(recordKey)) {
      failures.push(failure(kind, token, `duplicate record key ${recordKey}`));
    } else {
      seen.set(recordKey, index);
    }

    const isNew = !baselineUsable || !baseline[kind]?.has(token);
    if (kind === "formula" || kind === "cask") {
      if (isNew) newRecords[kind].push(token);
      if (isNew) checkedTokens.push(recordKey);
    }
    checkRecord(record, index, {
      allowNoCheck: opts.allowNoCheck,
      enforceNoCheck: isNew,
      failures,
      warnings,
    });
  }

  if (beforeReport && !baselineUsable) {
    warnings.push("--before-json did not include seeded_with_analytics token rows; no_check checks were applied to all records");
  }

  newRecords.formula.sort();
  newRecords.cask.sort();

  return {
    status: failures.length === 0 ? "pass" : "fail",
    record_count: records.length,
    new_record_count: checkedTokens.length,
    new_records: newRecords,
    allow_no_check: opts.allowNoCheck,
    warnings,
    failures,
  };
}

function checkRecord(record, index, ctx) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    ctx.failures.push(failure(null, null, `record #${index + 1} must be an object`));
    return;
  }

  const { token, kind } = record;
  if (!isNonEmptyString(token)) {
    ctx.failures.push(failure(kind, token, `record #${index + 1} token must be a non-empty string`));
  }
  if (!["formula", "cask"].includes(kind)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} kind must be formula or cask`));
  }
  for (const field of ["name", "homepage", "desc"]) {
    if (!isNonEmptyString(record[field])) {
      ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} ${field} must be a non-empty string`));
    }
  }

  checkUpstream(record, index, ctx);
  checkResolvedAssets(record, index, ctx);
  checkVerification(record, index, ctx);
  if (kind === "cask" && (!Array.isArray(record.artifacts) || record.artifacts.length === 0)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} casks must include artifacts`));
  }
}

function checkUpstream(record, index, ctx) {
  const { token, kind, upstream } = record;
  if (!upstream || typeof upstream !== "object" || Array.isArray(upstream)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} upstream must be an object`));
    return;
  }
  if (!isNonEmptyString(upstream.type)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} upstream.type must be a non-empty string`));
  }
  if (upstream.verified !== true) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} upstream.verified must be true`));
  }
  if (upstream.type === "github_release" && !/^[^/\s]+\/[^/\s]+$/.test(String(upstream.repo ?? ""))) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} github_release upstream.repo must be owner/name`));
  }
  if (upstream.type === "vendor_url") {
    if (!isNonEmptyString(upstream.release_feed)) {
      ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} vendor_url upstream.release_feed must be set`));
    }
    if (!Array.isArray(upstream.allow_domains) || upstream.allow_domains.length === 0) {
      ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} vendor_url upstream.allow_domains must not be empty`));
    }
  }
}

function checkResolvedAssets(record, index, ctx) {
  const { token, kind, resolved } = record;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} resolved must be an object`));
    return;
  }
  if (!isNonEmptyString(resolved.version) && !isNonEmptyString(resolved.tag)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} resolved.version or resolved.tag must be set`));
  }
  if (!resolved.assets || typeof resolved.assets !== "object" || Array.isArray(resolved.assets)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} resolved.assets must be an object`));
    return;
  }

  const assetEntries = Object.entries(resolved.assets);
  if (assetEntries.length === 0) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} resolved.assets must not be empty`));
  }
  for (const [platform, asset] of assetEntries) {
    const assetPath = `${describeRecord(kind, token, index)} resolved.assets.${platform}`;
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      ctx.failures.push(failure(kind, token, `${assetPath} must be an object`));
      continue;
    }
    if (!isHttpUrl(asset.url)) {
      ctx.failures.push(failure(kind, token, `${assetPath}.url must be an http(s) URL`));
    }
    checkSha256(record, index, `${assetPath}.sha256`, asset.sha256, ctx);
  }
}

function checkVerification(record, index, ctx) {
  const { token, kind, verification } = record;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} verification must be an object`));
    return;
  }
  const policy = verification.sha256;
  if (!isNonEmptyString(policy)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} verification.sha256 must be set`));
    return;
  }
  if (policy === "no_check") {
    checkNoCheck(record, index, `${describeRecord(kind, token, index)} verification.sha256`, ctx);
    return;
  }
  if (!["asset_digest", "required"].includes(policy)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} verification.sha256 has unsupported policy ${policy}`));
  }
}

function checkSha256(record, index, path, value, ctx) {
  const { token, kind } = record;
  if (value === "no_check") {
    checkNoCheck(record, index, path, ctx);
    return;
  }
  if (!/^[0-9a-f]{64}$/i.test(String(value ?? ""))) {
    ctx.failures.push(failure(kind, token, `${path} must be a 64-character sha256 digest`));
  }
}

function checkNoCheck(record, index, path, ctx) {
  const { token, kind } = record;
  if (ctx.enforceNoCheck && !ctx.allowNoCheck) {
    ctx.failures.push(failure(kind, token, `${path} uses no_check; pass --allow-no-check only after explicit review`));
    return;
  }
  if (ctx.enforceNoCheck && ctx.allowNoCheck && !isNonEmptyString(record.verification?.no_check_reason)) {
    ctx.failures.push(failure(kind, token, `${describeRecord(kind, token, index)} no_check records must include verification.no_check_reason`));
  }
}

async function checkBenchmarks(opts) {
  if (opts.benchJson.length === 0) {
    return {
      status: "skipped",
      files: [],
      thresholds: {
        min_speedup: opts.minSpeedup,
        allow_skips: opts.allowBenchmarkSkips,
      },
      failures: [],
    };
  }

  const files = [];
  const failures = [];
  for (const path of opts.benchJson) {
    const data = await readJson(path);
    const file = summarizeBenchmarkFile(path, data, opts, failures);
    files.push(file);
  }

  return {
    status: failures.length === 0 ? "pass" : "fail",
    files,
    thresholds: {
      min_speedup: opts.minSpeedup,
      allow_skips: opts.allowBenchmarkSkips,
    },
    failures,
  };
}

function summarizeBenchmarkFile(path, data, opts, failures) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const skipped = Array.isArray(data?.skipped) ? data.skipped : [];
  const summary = {
    path,
    kind: data?.kind ?? null,
    cold: Boolean(data?.cold),
    iterations: Number.isFinite(data?.iterations) ? data.iterations : null,
    rows: [],
    skipped,
  };

  if (!Array.isArray(data?.rows)) {
    failures.push(`${path}: rows must be an array`);
  } else if (rows.length === 0) {
    failures.push(`${path}: no benchmark rows were recorded`);
  }

  if (skipped.length > 0 && !opts.allowBenchmarkSkips) {
    failures.push(`${path}: ${skipped.length} skipped benchmark token(s); pass --allow-benchmark-skips to permit this`);
  }

  for (const row of rows) {
    const speedup = benchmarkSpeedup(row);
    const ok = Number.isFinite(speedup) && speedup >= opts.minSpeedup;
    summary.rows.push({
      token: row?.token ?? null,
      kind: row?.kind ?? data?.kind ?? null,
      upstream_median_ms: finiteNumberOrNull(row?.upstream_median_ms),
      homebrew_median_ms: finiteNumberOrNull(row?.homebrew_median_ms),
      speedup: Number.isFinite(speedup) ? round2(speedup) : null,
      ok,
    });

    if (!Number.isFinite(speedup)) {
      failures.push(`${path}: ${row?.token ?? "unknown"} benchmark speedup could not be computed`);
    } else if (speedup < opts.minSpeedup) {
      failures.push(`${path}: ${row?.token ?? "unknown"} speedup ${round2(speedup)}x is below ${opts.minSpeedup}x`);
    }
  }
  return summary;
}

function benchmarkSpeedup(row) {
  const explicit = Number(row?.speedup);
  if (Number.isFinite(explicit)) return explicit;
  const upstream = Number(row?.upstream_median_ms);
  const homebrew = Number(row?.homebrew_median_ms);
  if (!Number.isFinite(upstream) || upstream <= 0 || !Number.isFinite(homebrew)) return NaN;
  return homebrew / upstream;
}

function tokensByKindFromCoverage(report) {
  return {
    formula: tokensFromCoverageKind(report?.formula),
    cask: tokensFromCoverageKind(report?.cask),
  };
}

function tokensFromCoverageKind(kindReport) {
  const rows = Array.isArray(kindReport?.seeded_with_analytics) ? kindReport.seeded_with_analytics : [];
  return new Set(rows.map((row) => row?.token).filter(isNonEmptyString));
}

async function readJson(path) {
  return parseJson(await readFile(path, "utf8"), path);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`failed to parse JSON from ${label}: ${err.message}`);
  }
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function printHuman(result) {
  console.log(`${result.ok ? "PASS" : "FAIL"} upstream promotion check`);
  printCoverageHuman(result.coverage, result.top);
  printRegistryHuman(result.registry_checks);
  printBenchmarksHuman(result.benchmarks);

  if (result.failures.length > 0) {
    console.log("\nFailures:");
    for (const message of result.failures) {
      console.log(`  - ${message}`);
    }
  }
}

function printCoverageHuman(coverage, top) {
  const source = coverage.computed_after ? "computed after coverage" : "saved after coverage";
  console.log(`Coverage (${source}, top ${top}): ${coverage.status}`);
  if (coverage.reason) {
    console.log(`  ${coverage.reason}`);
  }
  printKindCoverageHuman("formula", coverage.formula);
  printKindCoverageHuman("cask", coverage.cask);
}

function printKindCoverageHuman(label, row) {
  console.log(
    `  ${label}: ${formatDelta(row.new_records)} records ` +
    `(${row.before_seeded_records} -> ${row.after_seeded_records}), ` +
    `${formatDelta(row.new_top_records)} top records, ` +
    `${row.before_top_coverage_percent}% -> ${row.after_top_coverage_percent}% ` +
    `(${formatDelta(row.top_coverage_point_delta)}pp), min ${row.min_new_records}`,
  );
}

function printRegistryHuman(registryChecks) {
  console.log(`Registry checks: ${registryChecks.status} (${registryChecks.record_count} records, ${registryChecks.new_record_count} new checked)`);
  if (registryChecks.new_records.formula.length > 0) {
    console.log(`  new formulae: ${registryChecks.new_records.formula.join(", ")}`);
  }
  if (registryChecks.new_records.cask.length > 0) {
    console.log(`  new casks: ${registryChecks.new_records.cask.join(", ")}`);
  }
  for (const warning of registryChecks.warnings) {
    console.log(`  warning: ${warning}`);
  }
}

function printBenchmarksHuman(benchmarks) {
  console.log(`Benchmarks: ${benchmarks.status}`);
  for (const file of benchmarks.files) {
    const cacheLabel = file.cold ? "cold" : "warm";
    console.log(`  ${file.path}: ${file.kind ?? "unknown"} ${cacheLabel}, ${file.rows.length} row(s), ${file.skipped.length} skipped`);
    for (const row of file.rows) {
      const status = row.ok ? "pass" : "fail";
      console.log(`    ${row.token ?? "unknown"} ${row.speedup ?? "?"}x ${status}`);
    }
  }
}

function failure(kind, token, message) {
  return {
    kind: kind ?? null,
    token: token ?? null,
    message,
  };
}

function describeRecord(kind, token, index) {
  if (isNonEmptyString(kind) && isNonEmptyString(token)) return `${kind}:${token}`;
  return `record #${index + 1}`;
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round2(value) {
  return Number(value.toFixed(2));
}

function formatDelta(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function parsePositiveInteger(value, label) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(number) || number < 1) die(`${label} must be a positive integer`);
  return number;
}

function parseNonNegativeInteger(value, label) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(number) || number < 0) die(`${label} must be a non-negative integer`);
  return number;
}

function parseNonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) die(`${label} must be a non-negative number`);
  return number;
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
