#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DEFAULT_REGISTRY = "registry/upstream.json";
const FORMULA_ANALYTICS_URL = "https://formulae.brew.sh/api/analytics/install-on-request/30d.json";
const CASK_ANALYTICS_URL = "https://formulae.brew.sh/api/analytics/cask-install/30d.json";
const FORMULA_URL = "https://formulae.brew.sh/api/formula.json";
const CASK_URL = "https://formulae.brew.sh/api/cask.json";
const JSON_FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "nanobrew-upstream-gap-report";

function parseArgs(argv) {
  const opts = {
    registry: DEFAULT_REGISTRY,
    top: 100,
    json: false,
    formulaAnalyticsFile: null,
    caskAnalyticsFile: null,
    formulaFile: null,
    caskFile: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--registry") {
      opts.registry = takeValue(argv, ++i, arg);
    } else if (arg.startsWith("--registry=")) {
      opts.registry = arg.slice("--registry=".length);
    } else if (arg === "--top") {
      opts.top = Number.parseInt(takeValue(argv, ++i, arg), 10);
    } else if (arg.startsWith("--top=")) {
      opts.top = Number.parseInt(arg.slice("--top=".length), 10);
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--formula-analytics-file") {
      opts.formulaAnalyticsFile = takeValue(argv, ++i, arg);
    } else if (arg.startsWith("--formula-analytics-file=")) {
      opts.formulaAnalyticsFile = arg.slice("--formula-analytics-file=".length);
    } else if (arg === "--cask-analytics-file") {
      opts.caskAnalyticsFile = takeValue(argv, ++i, arg);
    } else if (arg.startsWith("--cask-analytics-file=")) {
      opts.caskAnalyticsFile = arg.slice("--cask-analytics-file=".length);
    } else if (arg === "--formula-file" || arg === "--formula-metadata-file") {
      opts.formulaFile = takeValue(argv, ++i, arg);
    } else if (arg.startsWith("--formula-file=")) {
      opts.formulaFile = arg.slice("--formula-file=".length);
    } else if (arg.startsWith("--formula-metadata-file=")) {
      opts.formulaFile = arg.slice("--formula-metadata-file=".length);
    } else if (arg === "--cask-file" || arg === "--cask-metadata-file") {
      opts.caskFile = takeValue(argv, ++i, arg);
    } else if (arg.startsWith("--cask-file=")) {
      opts.caskFile = arg.slice("--cask-file=".length);
    } else if (arg.startsWith("--cask-metadata-file=")) {
      opts.caskFile = arg.slice("--cask-metadata-file=".length);
    } else if (arg === "-h" || arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(1);
    }
  }

  if (!opts.registry) die("--registry must not be empty");
  if (!Number.isInteger(opts.top) || opts.top < 1) die("--top must be a positive integer");
  return opts;
}

function takeValue(argv, index, option) {
  const value = argv[index];
  if (value == null || value.startsWith("--")) die(`${option} requires a value`);
  return value;
}

function usage(code) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`Usage: scripts/upstream-gap-report.mjs [options]

Classify top Homebrew analytics rows missing from the verified upstream registry.

Options:
  --registry PATH                 Registry to read (default: ${DEFAULT_REGISTRY})
  --top N                         Popular rows to classify per kind (default: 100)
  --json                          Emit machine-readable JSON
  --formula-analytics-file PATH   Read formula analytics JSON from disk instead of fetching
  --cask-analytics-file PATH      Read cask analytics JSON from disk instead of fetching
  --formula-file PATH             Read Homebrew formula metadata JSON from disk instead of fetching
  --formula-metadata-file PATH    Alias for --formula-file
  --cask-file PATH                Read Homebrew cask metadata JSON from disk instead of fetching
  --cask-metadata-file PATH       Alias for --cask-file
  -h, --help                      Show this help

Supplying both analytics files and both metadata files avoids network access.
`);
  process.exit(code);
}

function die(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [registry, formulaAnalytics, caskAnalytics, formulae, casks] = await Promise.all([
    readJson(opts.registry),
    loadJson(FORMULA_ANALYTICS_URL, opts.formulaAnalyticsFile),
    loadJson(CASK_ANALYTICS_URL, opts.caskAnalyticsFile),
    loadJson(FORMULA_URL, opts.formulaFile),
    loadJson(CASK_URL, opts.caskFile),
  ]);

  const records = registry.records ?? [];
  const formula = gapReportForKind({
    kind: "formula",
    records,
    analyticsItems: formulaAnalytics.items ?? [],
    metadataItems: Array.isArray(formulae) ? formulae : [],
    top: opts.top,
  });
  const cask = gapReportForKind({
    kind: "cask",
    records,
    analyticsItems: caskAnalytics.items ?? [],
    metadataItems: Array.isArray(casks) ? casks : [],
    top: opts.top,
  });

  const result = {
    registry: opts.registry,
    top: opts.top,
    sources: {
      formula_analytics: sourceInfo(FORMULA_ANALYTICS_URL, opts.formulaAnalyticsFile),
      cask_analytics: sourceInfo(CASK_ANALYTICS_URL, opts.caskAnalyticsFile),
      formula_metadata: sourceInfo(FORMULA_URL, opts.formulaFile),
      cask_metadata: sourceInfo(CASK_URL, opts.caskFile),
    },
    summary: {
      formula: formula.summary,
      cask: cask.summary,
    },
    formula: {
      gaps: formula.gaps,
    },
    cask: {
      gaps: cask.gaps,
    },
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  printHuman(result);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadJson(url, file) {
  if (file) return readJson(file);
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  }, JSON_FETCH_TIMEOUT_MS);
  if (!response.ok) throw new Error(`fetch failed for ${url}: HTTP ${response.status}`);
  return response.json();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sourceInfo(url, file) {
  return file ? { type: "file", path: file } : { type: "url", url };
}

function gapReportForKind({ kind, records, analyticsItems, metadataItems, top }) {
  const seeded = new Set(records.map((record) => `${record.kind}:${record.token}`));
  const registryRecords = records.filter((record) => record.kind === kind);
  const metadataByToken = metadataMap(kind, metadataItems);
  const topRows = rankedAnalyticsRows(kind, analyticsItems, top);
  const seededRows = topRows.filter((row) => seeded.has(`${kind}:${row.token}`));
  const gaps = topRows
    .filter((row) => !seeded.has(`${kind}:${row.token}`))
    .map((row) => classifyGap(kind, row, metadataByToken.get(row.token)));

  const totalCount = sum(topRows.map((row) => row.count));
  const seededCount = sum(seededRows.map((row) => row.count));

  return {
    summary: {
      registry_records: registryRecords.length,
      top_total_records: topRows.length,
      top_seeded_records: seededRows.length,
      top_gap_records: gaps.length,
      top_total_30d_count: totalCount,
      top_seeded_30d_count: seededCount,
      top_gap_30d_count: totalCount - seededCount,
      top_seeded_coverage_percent: percent(seededCount, totalCount),
      by_skip_bucket: bucketSummary(gaps, "skip_bucket"),
      by_current_shape: bucketSummary(gaps, "current_shape"),
      by_resolver_class: bucketSummary(gaps, "resolver_class"),
      by_verification: bucketSummary(gaps, "verification"),
    },
    gaps,
  };
}

function rankedAnalyticsRows(kind, analyticsItems, top) {
  const tokenKey = kind === "formula" ? "formula" : "cask";
  return analyticsItems
    .slice(0, top)
    .map((item, index) => ({
      kind,
      token: item[tokenKey] ?? "",
      rank: Number.parseInt(String(item.number ?? ""), 10) || index + 1,
      count_text: item.count ?? "",
      count: parseCount(item.count),
    }))
    .filter((item) => item.token);
}

function metadataMap(kind, items) {
  const map = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (kind === "formula") {
      addMetadataKey(map, item.name, item);
      addMetadataKey(map, item.full_name, item);
      addMetadataKey(map, item.full_token, item);
      if (item.tap && item.name && item.tap !== "homebrew/core") {
        addMetadataKey(map, `${item.tap}/${item.name}`, item);
      }
    } else {
      addMetadataKey(map, item.token, item);
      addMetadataKey(map, item.full_token, item);
      if (item.tap && item.token && item.tap !== "homebrew/cask") {
        addMetadataKey(map, `${item.tap}/${item.token}`, item);
      }
    }
  }
  return map;
}

function addMetadataKey(map, key, item) {
  if (typeof key === "string" && key.length > 0 && !map.has(key)) {
    map.set(key, item);
  }
}

function classifyGap(kind, row, metadata) {
  return kind === "formula"
    ? classifyFormulaGap(row, metadata)
    : classifyCaskGap(row, metadata);
}

function classifyFormulaGap(row, formula) {
  if (!formula) {
    const resolverClass = isTapToken(row.token) ? "tap_formula" : "unsupported";
    return {
      ...baseGapRow(row),
      name: "",
      version: "",
      homepage: "",
      desc: "",
      skip_reason: "formula metadata missing",
      skip_bucket: "formula_metadata_missing",
      current_shape: isTapToken(row.token) ? "tap_formula_metadata_missing" : "metadata_missing",
      resolver_class: resolverClass,
      verification: "metadata_missing",
      checksum_verification: {
        available: false,
        status: "metadata_missing",
      },
      current_seeder: {
        status: "skipped",
        reason: "formula metadata missing",
      },
      homebrew: {
        metadata_found: false,
        tap: tapPrefix(row.token),
        source_url: "",
        source_url_class: "metadata_missing",
        source_url_host: "",
        source_versioned: false,
        bottle: emptyBottleInfo(),
      },
    };
  }

  const sourceUrl = formula?.urls?.stable?.url ?? "";
  const sourceSha256 = formula?.urls?.stable?.checksum ?? "";
  const urlInfo = classifyUrl(sourceUrl, formula?.versions?.stable ?? "");
  const bottle = bottleInfo(formula);
  const currentSeeder = formulaSeederStatus(formula);
  const verification = formulaVerification(sourceSha256, bottle);
  const currentShape = formulaCurrentShape(urlInfo, bottle);
  const resolverClass = formulaResolverClass(row.token, formula, urlInfo, bottle, sourceSha256);

  return {
    ...baseGapRow(row),
    name: formula.full_name ?? formula.name ?? row.token,
    version: formula?.versions?.stable ?? "",
    homepage: formula.homepage ?? "",
    desc: formula.desc ?? "",
    skip_reason: currentSeeder.reason,
    skip_bucket: currentSeeder.status === "skipped"
      ? bucketizeReason(currentSeeder.reason)
      : "github_latest_release_probe_required",
    current_shape: currentShape,
    resolver_class: resolverClass,
    verification: verification.status,
    checksum_verification: verification,
    current_seeder: currentSeeder,
    homebrew: {
      metadata_found: true,
      tap: formula.tap ?? "",
      ruby_source_path: formula.ruby_source_path ?? "",
      source_url: sourceUrl,
      source_url_class: urlInfo.url_class,
      source_url_host: urlInfo.host,
      source_asset: urlInfo.asset,
      source_versioned: urlInfo.versioned,
      bottle,
    },
  };
}

function classifyCaskGap(row, cask) {
  if (!cask) {
    const resolverClass = isTapToken(row.token) ? "tap_cask" : "unsupported";
    return {
      ...baseGapRow(row),
      name: "",
      version: "",
      homepage: "",
      desc: "",
      skip_reason: "cask metadata missing",
      skip_bucket: "cask_metadata_missing",
      current_shape: isTapToken(row.token) ? "tap_cask_metadata_missing" : "metadata_missing",
      resolver_class: resolverClass,
      artifact_class: "metadata_missing",
      verification: "metadata_missing",
      checksum_verification: {
        available: false,
        status: "metadata_missing",
      },
      current_seeder: {
        status: "skipped",
        reason: "cask metadata missing",
      },
      homebrew: {
        metadata_found: false,
        tap: tapPrefix(row.token),
        url: "",
        url_class: "metadata_missing",
        url_host: "",
        url_versioned: false,
        artifacts: emptyArtifactSummary(),
        variations: emptyVariationSummary(),
      },
    };
  }

  const urlInfo = classifyUrl(cask.url ?? "", cask.version ?? "");
  const artifacts = artifactSummary(cask.artifacts ?? []);
  const artifactClass = caskArtifactClass(artifacts, urlInfo);
  const currentSeeder = caskSeederStatus(cask);
  const verification = caskVerification(cask);
  const resolverClass = caskResolverClass(row.token, cask, urlInfo, artifacts, artifactClass);

  return {
    ...baseGapRow(row),
    name: caskName(cask),
    version: cask.version ?? "",
    homepage: cask.homepage ?? "",
    desc: cask.desc ?? "",
    skip_reason: currentSeeder.reason,
    skip_bucket: currentSeeder.status === "skipped"
      ? bucketizeReason(currentSeeder.reason)
      : "github_release_digest_probe_required",
    current_shape: `${urlInfo.url_class}_${artifactClass}`,
    resolver_class: resolverClass,
    artifact_class: artifactClass,
    verification: verification.status,
    checksum_verification: verification,
    current_seeder: currentSeeder,
    homebrew: {
      metadata_found: true,
      tap: cask.tap ?? "",
      ruby_source_path: cask.ruby_source_path ?? "",
      url: cask.url ?? "",
      url_class: urlInfo.url_class,
      url_host: urlInfo.host,
      url_asset: urlInfo.asset,
      url_versioned: urlInfo.versioned,
      sha256_policy: cask.sha256 ?? "",
      auto_updates: cask.auto_updates === true,
      artifacts,
      variations: variationSummary(cask),
    },
  };
}

function baseGapRow(row) {
  return {
    kind: row.kind,
    token: row.token,
    rank: row.rank,
    count_text: row.count_text,
    count: row.count,
  };
}

function formulaSeederStatus(formula) {
  const repo = githubRepoForFormula(formula);
  if (!repo) {
    return {
      status: "skipped",
      reason: "no GitHub upstream repo",
      expected_shape: "github_release",
    };
  }
  return {
    status: "probe_required",
    reason: "requires GitHub latest release probe",
    expected_shape: "github_release",
    repo,
  };
}

function caskSeederStatus(cask) {
  const base = githubReleaseAssetParts(cask.url);
  if (!base) {
    return {
      status: "skipped",
      reason: "not a GitHub release asset cask",
      expected_shape: "github_release_asset_app_cask",
    };
  }

  const artifacts = caskArtifacts(cask, { includePkg: false, includeBinaries: true });
  if (!artifacts.ok) {
    return {
      status: "skipped",
      reason: artifacts.reason,
      expected_shape: "github_release_asset_app_cask",
      repo: base.repo,
      tag: base.tag,
    };
  }

  const downloads = collectPlatformDownloads(cask, base);
  if (downloads.size === 0) {
    return {
      status: "skipped",
      reason: "no supported macOS platform downloads",
      expected_shape: "github_release_asset_app_cask",
      repo: base.repo,
      tag: base.tag,
    };
  }
  if (!downloads.has("macos-arm64")) {
    return {
      status: "skipped",
      reason: "no macos-arm64 download",
      expected_shape: "github_release_asset_app_cask",
      repo: base.repo,
      tag: base.tag,
      platforms: [...downloads.keys()].sort(),
    };
  }

  return {
    status: "probe_required",
    reason: "requires GitHub release asset digest probe",
    expected_shape: "github_release_asset_app_cask",
    repo: base.repo,
    tag: base.tag,
    platforms: [...downloads.keys()].sort(),
    artifacts: artifacts.items,
  };
}

function formulaCurrentShape(urlInfo, bottle) {
  const bottleSuffix = bottle.available ? "with_bottle" : "without_bottle";
  return `${urlInfo.url_class}_${bottleSuffix}`;
}

function formulaResolverClass(token, formula, urlInfo, bottle, sourceSha256) {
  if (isTapToken(token) || (formula.tap && formula.tap !== "homebrew/core")) return "tap_formula";
  if (urlInfo.url_class === "github_release_asset") return "github_release_asset";
  if (urlInfo.url_class === "github_archive_source" || urlInfo.url_class === "github_git_repo_source") return "github_source_build";
  if (urlInfo.url_class === "vendor_direct_binary") return "vendor_direct_binary";
  if (urlInfo.url_class === "vendor_pkg") return "vendor_pkg";
  if (urlInfo.is_archive && isSha256(sourceSha256) && urlInfo.versioned) return "vendor_source_build";
  if (urlInfo.is_archive && isSha256(sourceSha256)) return "source_build_only";
  if (bottle.sha256_available) return "homebrew_bottle_lock";
  return "unsupported";
}

function caskResolverClass(token, cask, urlInfo, artifacts, artifactClass) {
  if (isTapToken(token) || (cask.tap && cask.tap !== "homebrew/cask")) return "tap_cask";
  if (artifacts.install_types.includes("binary") && isLikelyCliCask(token, cask, artifacts)) {
    return "package_manager_cli";
  }
  if (urlInfo.url_class === "github_release_asset") return "github_release_asset";
  if (artifactClass === "pkg_cask") return "pkg_cask";
  if (artifactClass === "app_cask" || artifactClass === "dmg_app_cask") return "app_cask";
  if (artifactClass === "installer_cask") return "installer_cask";
  if (urlInfo.versioned && (urlInfo.is_archive || urlInfo.asset_kind === "direct_binary")) {
    return "direct_versioned_archive";
  }
  if (urlInfo.host) return "vendor_url";
  return "unsupported";
}

function formulaVerification(sourceSha256, bottle) {
  if (isSha256(sourceSha256)) {
    return {
      available: true,
      status: "homebrew_source_sha256",
      homebrew_bottle_sha256: bottle.sha256_available,
      homebrew_source_sha256: true,
    };
  }
  if (bottle.sha256_available) {
    return {
      available: true,
      status: "homebrew_bottle_sha256",
      homebrew_bottle_sha256: true,
      homebrew_source_sha256: false,
    };
  }
  return {
    available: false,
    status: "missing_sha256",
    homebrew_bottle_sha256: false,
    homebrew_source_sha256: false,
  };
}

function caskVerification(cask) {
  const variationSha256Count = Object.values(cask.variations ?? {})
    .filter((variation) => isSha256(variation?.sha256))
    .length;
  if (isSha256(cask.sha256)) {
    return {
      available: true,
      status: "homebrew_sha256",
      homebrew_sha256: true,
      homebrew_no_check: false,
      variation_sha256_count: variationSha256Count,
    };
  }
  if (cask.sha256 === "no_check") {
    return {
      available: false,
      status: "homebrew_no_check",
      homebrew_sha256: false,
      homebrew_no_check: true,
      variation_sha256_count: variationSha256Count,
    };
  }
  if (variationSha256Count > 0) {
    return {
      available: true,
      status: "homebrew_variation_sha256",
      homebrew_sha256: false,
      homebrew_no_check: false,
      variation_sha256_count: variationSha256Count,
    };
  }
  return {
    available: false,
    status: "missing_sha256",
    homebrew_sha256: false,
    homebrew_no_check: false,
    variation_sha256_count: variationSha256Count,
  };
}

function classifyUrl(value, version) {
  if (typeof value !== "string" || value.length === 0) {
    return emptyUrlInfo();
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return {
      ...emptyUrlInfo(),
      url_class: "invalid_url",
    };
  }

  const asset = assetNameFromUrl(value);
  const lowerAsset = asset.toLowerCase();
  const github = githubParts(value);
  const assetKind = assetKindFromName(lowerAsset);
  const isArchive = isArchiveName(lowerAsset);
  const versioned = versionAppearsInUrl(value, version);

  if (github) {
    const githubClass = githubUrlClass(github);
    return {
      url: value,
      host: url.hostname,
      asset,
      asset_kind: assetKind,
      is_archive: isArchive,
      versioned,
      url_class: githubClass,
      repo: github.fullName,
      tag: githubClass === "github_release_asset" ? github.rest[2] ?? "" : "",
    };
  }

  return {
    url: value,
    host: url.hostname,
    asset,
    asset_kind: assetKind,
    is_archive: isArchive,
    versioned,
    url_class: vendorUrlClass(assetKind, isArchive),
    repo: "",
    tag: "",
  };
}

function emptyUrlInfo() {
  return {
    url: "",
    host: "",
    asset: "",
    asset_kind: "missing",
    is_archive: false,
    versioned: false,
    url_class: "missing_url",
    repo: "",
    tag: "",
  };
}

function vendorUrlClass(assetKind, isArchive) {
  if (assetKind === "dmg") return "vendor_dmg";
  if (assetKind === "pkg") return "vendor_pkg";
  if (isArchive) return "vendor_archive";
  if (assetKind === "direct_binary") return "vendor_direct_binary";
  return "vendor_url";
}

function assetKindFromName(name) {
  if (!name) return "direct_binary";
  if (/\.dmg$/i.test(name)) return "dmg";
  if (/\.pkg$/i.test(name)) return "pkg";
  if (isArchiveName(name)) return "archive";
  if (/\.(exe|msi|deb|rpm)$/i.test(name)) return "foreign_package";
  if (!name.includes(".")) return "direct_binary";
  return "file";
}

function isArchiveName(name) {
  return /\.(tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|zip|gz|xz|bz2)$/i.test(name);
}

function versionAppearsInUrl(value, version) {
  const decoded = decodeURIComponent(String(value ?? "")).toLowerCase();
  for (const token of versionTokens(version)) {
    if (decoded.includes(token.toLowerCase())) return true;
  }
  return false;
}

function versionTokens(version) {
  return String(version ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1 && item !== "latest");
}

function githubRepoForFormula(formula) {
  for (const value of [formula?.urls?.stable?.url, formula?.homepage]) {
    const repo = githubRepoFromUrl(value);
    if (repo) return repo;
  }
  return "";
}

function githubRepoFromUrl(value) {
  const parts = githubParts(value);
  return parts?.fullName ?? "";
}

function githubParts(value) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, rawRepo] = parts;
  const isGitRepoUrl = rawRepo.endsWith(".git") && parts.length === 2;
  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -".git".length) : rawRepo;
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    rest: parts.slice(2).map((part) => decodeURIComponent(part)),
    isGitRepoUrl,
  };
}

function githubUrlClass(parts) {
  if (parts.rest[0] === "releases" && parts.rest[1] === "download") return "github_release_asset";
  if (parts.rest[0] === "archive") return "github_archive_source";
  if (parts.isGitRepoUrl) return "github_git_repo_source";
  return "github_other";
}

function githubReleaseAssetParts(value) {
  const parts = githubParts(value);
  if (!parts || parts.rest[0] !== "releases" || parts.rest[1] !== "download") return null;
  if (parts.rest.length < 4) return null;
  return {
    repo: parts.fullName,
    tag: parts.rest[2],
    asset: parts.rest.slice(3).join("/"),
  };
}

function assetNameFromUrl(value) {
  try {
    const url = new URL(value);
    const item = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return decodeURIComponent(item);
  } catch {
    return "";
  }
}

function bottleInfo(formula) {
  const files = formula?.bottle?.stable?.files;
  if (!files || typeof files !== "object") return emptyBottleInfo();

  const platforms = Object.entries(files)
    .map(([platform, data]) => ({
      platform,
      url_available: typeof data?.url === "string" && data.url.length > 0,
      sha256_available: isSha256(data?.sha256),
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));
  const sha256Count = platforms.filter((platform) => platform.sha256_available).length;

  return {
    available: platforms.length > 0,
    sha256_available: sha256Count > 0,
    sha256_platforms: sha256Count,
    platforms: platforms.map((platform) => platform.platform),
  };
}

function emptyBottleInfo() {
  return {
    available: false,
    sha256_available: false,
    sha256_platforms: 0,
    platforms: [],
  };
}

function artifactSummary(artifacts) {
  const counts = new Map();
  const samples = [];

  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") continue;
    for (const [type, value] of Object.entries(artifact)) {
      const count = artifactCount(value);
      counts.set(type, (counts.get(type) ?? 0) + count);
      for (const sample of artifactSamples(type, value)) {
        if (samples.length < 8) samples.push(sample);
      }
    }
  }

  const sortedTypes = [...counts.keys()].sort();
  return {
    types: sortedTypes,
    install_types: sortedTypes.filter((type) => ["app", "pkg", "binary", "installer"].includes(type)),
    counts: Object.fromEntries(sortedTypes.map((type) => [type, counts.get(type)])),
    samples,
  };
}

function emptyArtifactSummary() {
  return {
    types: [],
    install_types: [],
    counts: {},
    samples: [],
  };
}

function artifactCount(value) {
  if (Array.isArray(value)) return Math.max(1, value.filter((item) => item != null).length);
  if (value == null) return 0;
  return 1;
}

function artifactSamples(type, value) {
  const samples = [];
  if (!Array.isArray(value)) return samples;
  for (const entry of value) {
    if (typeof entry === "string") {
      samples.push({ type, path: entry });
    } else if (entry && typeof entry === "object") {
      const target = entry.target;
      if (typeof target === "string") samples.push({ type, target });
    }
  }
  return samples;
}

function caskArtifactClass(artifacts, urlInfo) {
  if (artifacts.install_types.includes("app")) {
    return urlInfo.asset_kind === "dmg" ? "dmg_app_cask" : "app_cask";
  }
  if (artifacts.install_types.includes("pkg")) return "pkg_cask";
  if (artifacts.install_types.includes("installer")) return "installer_cask";
  if (artifacts.install_types.includes("binary")) return "binary_cask";
  if (urlInfo.asset_kind === "dmg") return "dmg_cask";
  if (urlInfo.asset_kind === "pkg") return "pkg_cask";
  return "unsupported_cask";
}

function isLikelyCliCask(token, cask, artifacts) {
  if (!artifacts.install_types.includes("binary")) return false;
  if (!artifacts.install_types.includes("app") && !artifacts.install_types.includes("pkg")) return true;
  const text = `${token} ${caskName(cask)} ${cask.desc ?? ""}`.toLowerCase();
  return /\b(cli|command.?line|terminal|sdk|developer tool|coding agent)\b/.test(text);
}

function variationSummary(cask) {
  const entries = Object.entries(cask.variations ?? {});
  if (entries.length === 0) return emptyVariationSummary();
  const urlClassCounts = new Map();
  let urlCount = 0;
  let sha256Count = 0;

  for (const [, variation] of entries) {
    if (!variation || typeof variation !== "object") continue;
    if (typeof variation.url === "string") {
      urlCount += 1;
      const urlClass = classifyUrl(variation.url, cask.version ?? "").url_class;
      urlClassCounts.set(urlClass, (urlClassCounts.get(urlClass) ?? 0) + 1);
    }
    if (isSha256(variation.sha256)) sha256Count += 1;
  }

  return {
    count: entries.length,
    keys: entries.map(([key]) => key).sort(),
    url_count: urlCount,
    sha256_count: sha256Count,
    url_classes: sortedBucketObject(urlClassCounts),
  };
}

function emptyVariationSummary() {
  return {
    count: 0,
    keys: [],
    url_count: 0,
    sha256_count: 0,
    url_classes: {},
  };
}

function caskArtifacts(cask, opts) {
  const items = [];
  let appCount = 0;
  let pkgCount = 0;

  for (const artifact of cask.artifacts ?? []) {
    if (!artifact || typeof artifact !== "object") continue;
    if (Array.isArray(artifact.app)) {
      if (hasObjectEntry(artifact.app)) return { ok: false, reason: "app artifact target unsupported" };
      for (const path of artifact.app) {
        if (typeof path !== "string") continue;
        if (!safeAppPath(path)) return { ok: false, reason: "unsafe app artifact path" };
        items.push({ type: "app", path });
        appCount += 1;
      }
    }
    if (opts.includePkg && Array.isArray(artifact.pkg)) {
      if (hasObjectEntry(artifact.pkg)) return { ok: false, reason: "pkg artifact target unsupported" };
      for (const path of artifact.pkg) {
        if (typeof path !== "string") continue;
        if (!safePkgPath(path)) return { ok: false, reason: "unsafe pkg artifact path" };
        items.push({ type: "pkg", path });
        pkgCount += 1;
      }
    }
    if (opts.includeBinaries && Array.isArray(artifact.binary)) {
      if (hasObjectEntry(artifact.binary)) continue;
      for (const path of artifact.binary) {
        if (typeof path !== "string") continue;
        if (!safeBinarySource(path)) continue;
        items.push({ type: "binary", path });
      }
    }
  }

  if (appCount === 0 && pkgCount === 0) {
    return { ok: false, reason: opts.includePkg ? "no supported app or pkg artifacts" : "no supported app artifacts" };
  }
  return { ok: true, items };
}

function hasObjectEntry(items) {
  return items.some((item) => item && typeof item === "object");
}

function safeAppPath(path) {
  return path.endsWith(".app") && !path.includes("..") && !path.includes("/");
}

function safePkgPath(path) {
  return path.endsWith(".pkg") && !path.includes("..") && !path.startsWith("/");
}

function safeBinarySource(path) {
  if (path.includes("..")) return false;
  if (path.startsWith("$HOMEBREW_PREFIX")) return false;
  if (path.startsWith("$APPDIR/")) return true;
  if (path.startsWith("/")) return true;
  return !path.includes("/");
}

function collectPlatformDownloads(cask, base) {
  const downloads = new Map();
  addPlatformDownload(downloads, cask.url, cask.sha256, "", base, false);

  for (const [key, variation] of Object.entries(cask.variations ?? {})) {
    if (!variation || typeof variation !== "object") continue;
    if (typeof variation.url !== "string" || typeof variation.sha256 !== "string") continue;
    const parts = githubReleaseAssetParts(variation.url);
    if (!parts || parts.repo !== base.repo || parts.tag !== base.tag) continue;
    addPlatformDownload(downloads, variation.url, variation.sha256, key, base, true);
  }
  return downloads;
}

function addPlatformDownload(downloads, url, sha256, variationKey, base, isVariation) {
  if (!isSha256(sha256)) return;
  const parts = githubReleaseAssetParts(url);
  if (!parts || parts.repo !== base.repo || parts.tag !== base.tag) return;
  for (const platform of platformsForDownload(url, variationKey, isVariation)) {
    if (!downloads.has(platform)) {
      downloads.set(platform, { url, sha256: sha256.toLowerCase() });
    }
  }
}

function platformsForDownload(url, variationKey, isVariation) {
  const s = `${url} ${variationKey}`.toLowerCase();
  const universal = /universal|x86_64\+arm64|arm64\+x86_64|amd64\+arm64|arm64\+amd64/.test(s);
  if (universal) return ["macos-arm64", "macos-x86_64"];

  const arm = /(?:arm64|aarch64|apple[-_ ]?silicon|macos[_-]?arm)/.test(s);
  const x86 = /(?:x86_64|amd64|x64|intel|64bit|macos[_-]?64)/.test(s);
  if (arm && !x86) return ["macos-arm64"];
  if (x86 && !arm) return ["macos-x86_64"];
  if (/^arm64(?:_|$)/.test(variationKey)) return ["macos-arm64"];
  if (isVariation && variationKey) return ["macos-x86_64"];
  return ["macos-arm64", "macos-x86_64"];
}

function bucketSummary(rows, key) {
  const buckets = new Map();
  for (const row of rows) {
    const bucket = row[key] ?? "unknown";
    const value = buckets.get(bucket) ?? { records: 0, count_30d: 0 };
    value.records += 1;
    value.count_30d += row.count;
    buckets.set(bucket, value);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1].count_30d - a[1].count_30d || b[1].records - a[1].records || a[0].localeCompare(b[0]))
    .map(([bucket, value]) => ({ bucket, ...value }));
}

function sortedBucketObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function bucketizeReason(reason) {
  return String(reason ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function parseCount(value) {
  if (typeof value === "number") return value;
  return Number.parseInt(String(value ?? "").replaceAll(",", ""), 10) || 0;
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

function percent(numerator, denominator) {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isTapToken(token) {
  return String(token ?? "").includes("/");
}

function tapPrefix(token) {
  const parts = String(token ?? "").split("/");
  return parts.length >= 3 ? parts.slice(0, -1).join("/") : "";
}

function caskName(cask) {
  if (Array.isArray(cask.name) && typeof cask.name[0] === "string" && cask.name[0].length > 0) {
    return cask.name[0];
  }
  return cask.token ?? "";
}

function printHuman(result) {
  console.log(`Upstream gap classification (${result.registry}, top ${result.top})`);
  printKind("Formulae", result.summary.formula, result.formula.gaps);
  printKind("Casks", result.summary.cask, result.cask.gaps);
}

function printKind(label, summary, gaps) {
  console.log(`\n${label}:`);
  console.log(`  seeded in top ${summary.top_total_records}: ${summary.top_seeded_records}`);
  console.log(`  unseeded gaps: ${summary.top_gap_records}`);
  console.log(`  top 30d count covered: ${summary.top_seeded_30d_count.toLocaleString()} / ${summary.top_total_30d_count.toLocaleString()} (${summary.top_seeded_coverage_percent}%)`);
  printBucketLine("resolver classes", summary.by_resolver_class);
  printBucketLine("current seeder buckets", summary.by_skip_bucket);
  printBucketLine("verification", summary.by_verification);

  console.log("  highest-ranked gaps:");
  for (const row of gaps.slice(0, 12)) {
    const shape = row.artifact_class ? `${row.current_shape}` : row.current_shape;
    console.log(`    #${row.rank} ${row.token} ${row.count_text} resolver=${row.resolver_class} skip=${row.skip_bucket}`);
    console.log(`      shape=${shape} verification=${row.verification}`);
  }
}

function printBucketLine(label, buckets) {
  const rendered = buckets
    .slice(0, 6)
    .map((bucket) => `${bucket.bucket}: ${bucket.records} (${bucket.count_30d.toLocaleString()})`)
    .join("; ");
  console.log(`  ${label}: ${rendered || "none"}`);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
