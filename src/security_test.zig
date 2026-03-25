// security_test.zig — Adversarial security tests for nanobrew
//
// Tests injection attacks against public APIs.
// Internal function tests (isPathSafe, writeJsonEscaped) live in their own modules.

const std = @import("std");
const testing = std.testing;
const version = @import("version.zig");

// ── Version comparison adversarial tests ──

test "version: special characters don't crash" {
    // Malicious version strings should compare without panicking
    _ = version.compareVersions("1.0;rm -rf /", "2.0");
    _ = version.compareVersions("$(whoami)", "1.0");
    _ = version.compareVersions("1.0\nmalicious", "1.0");
    _ = version.compareVersions("", "");
    _ = version.compareVersions("a", "b");
}

test "version: very long version strings don't crash" {
    // 200-segment version string
    var buf: [800]u8 = undefined;
    var len: usize = 0;
    for (0..200) |i| {
        if (i > 0) {
            buf[len] = '.';
            len += 1;
        }
        buf[len] = '1';
        len += 1;
    }
    const long_ver = buf[0..len];
    _ = version.compareVersions(long_ver, "1.0");
    _ = version.compareVersions("1.0", long_ver);
}

test "version: null bytes in version string" {
    _ = version.compareVersions("1.0\x002.0", "1.0");
    _ = version.compareVersions("1.0", "1.0\x00evil");
}

test "version: unicode in version string" {
    _ = version.compareVersions("1.0-café", "1.0-cafe");
    _ = version.compareVersions("1.0-日本語", "1.0");
}

test "version: isNewer is consistent" {
    // If a > b, then b must not be > a
    const pairs = [_][2][]const u8{
        .{ "2.0", "1.0" },
        .{ "1.10", "1.9" },
        .{ "10.47_1", "10.47" },
        .{ "0.1.067", "0.1.06" },
    };
    for (pairs) |pair| {
        try testing.expect(version.isNewer(pair[0], pair[1]));
        try testing.expect(!version.isNewer(pair[1], pair[0]));
    }
}

test "version: equal versions" {
    try testing.expect(!version.isNewer("1.0", "1.0"));
    try testing.expect(!version.isNewer("", ""));
    try testing.expect(!version.isNewer("10.47_1", "10.47_1"));
}
