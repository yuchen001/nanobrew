// nanobrew — Native HTTP fetch (zero curl dependency)
//
// Replaces all curl subprocess spawns with Zig's std.http.Client.
// Follows redirects. Auto-decompresses gzip responses.

const std = @import("std");
const flate = std.compress.flate;

const DOWNLOAD_STREAM_BUFFER_SIZE = 256 * 1024;

/// Fetch a URL and return the response body as an owned slice.
/// Caller must free the returned slice with `alloc.free()`.
/// Follows up to 5 redirects. Auto-decompresses gzip. Returns error on non-200 status.
pub fn get(alloc: std.mem.Allocator, url: []const u8) ![]u8 {
    var client: std.http.Client = .{ .allocator = alloc, .io = std.Io.Threaded.global_single_threaded.io() };
    defer client.deinit();
    return getWithClient(alloc, &client, url);
}

/// Fetch using an existing client (avoids repeated TLS setup).
pub fn getWithClient(alloc: std.mem.Allocator, client: *std.http.Client, url: []const u8) ![]u8 {
    return getWithClientHeaders(alloc, client, url, &.{});
}

/// Fetch a URL with additional headers and return the response body as an owned slice.
pub fn getWithHeaders(alloc: std.mem.Allocator, url: []const u8, extra_headers: []const std.http.Header) ![]u8 {
    var client: std.http.Client = .{ .allocator = alloc, .io = std.Io.Threaded.global_single_threaded.io() };
    defer client.deinit();
    return getWithClientHeaders(alloc, &client, url, extra_headers);
}

/// Fetch using an existing client plus additional headers.
pub fn getWithClientHeaders(alloc: std.mem.Allocator, client: *std.http.Client, url: []const u8, extra_headers: []const std.http.Header) ![]u8 {
    const uri = std.Uri.parse(url) catch return error.InvalidUrl;
    var req = client.request(.GET, uri, .{
        // Reduced from 5; HTTPS-to-HTTP downgrade not yet detectable in std.http
        .redirect_behavior = @enumFromInt(3),
        .extra_headers = extra_headers,
    }) catch return error.FetchFailed;

    req.sendBodiless() catch {
        req.deinit();
        return error.FetchFailed;
    };

    var head_buf: [32768]u8 = undefined;
    var response = req.receiveHead(&head_buf) catch {
        req.deinit();
        return error.FetchFailed;
    };
    if (response.head.status != .ok) {
        req.deinit();
        return error.FetchFailed;
    }

    // Stream raw response body to memory
    var out: std.Io.Writer.Allocating = .init(alloc);
    var reader = response.reader(&.{});
    _ = reader.streamRemaining(&out.writer) catch {
        out.deinit();
        req.deinit();
        return error.FetchFailed;
    };
    req.deinit();

    const raw = out.toOwnedSlice() catch {
        out.deinit();
        return error.OutOfMemory;
    };

    // Auto-decompress gzip if server sent compressed response
    if (response.head.content_encoding == .gzip) {
        defer alloc.free(raw);
        return decompressGzip(alloc, raw);
    }

    return raw;
}

fn decompressGzip(alloc: std.mem.Allocator, data: []const u8) ![]u8 {
    var fixed_reader = std.Io.Reader.fixed(data);
    var window: [flate.max_window_len]u8 = undefined;
    var decomp = flate.Decompress.init(&fixed_reader, .gzip, &window);

    var result: std.Io.Writer.Allocating = .init(alloc);
    errdefer result.deinit();
    _ = decomp.reader.streamRemaining(&result.writer) catch return error.FetchFailed;
    return result.toOwnedSlice() catch return error.OutOfMemory;
}

/// Fetch a URL and write the response body directly to a file.
pub fn download(alloc: std.mem.Allocator, url: []const u8, dest_path: []const u8) !void {
    var client: std.http.Client = .{ .allocator = alloc, .io = std.Io.Threaded.global_single_threaded.io() };
    defer client.deinit();
    return downloadWithClient(&client, url, dest_path);
}

/// Download using an existing client.
pub fn downloadWithClient(client: *std.http.Client, url: []const u8, dest_path: []const u8) !void {
    return downloadWithClientHeaders(client, url, dest_path, &.{});
}

/// Download using an existing client plus additional headers.
pub fn downloadWithClientHeaders(client: *std.http.Client, url: []const u8, dest_path: []const u8, extra_headers: []const std.http.Header) !void {
    const uri = std.Uri.parse(url) catch return error.InvalidUrl;
    var req = client.request(.GET, uri, .{
        // Reduced from 5; HTTPS-to-HTTP downgrade not yet detectable in std.http
        .redirect_behavior = @enumFromInt(3),
        .extra_headers = extra_headers,
    }) catch return error.FetchFailed;

    req.sendBodiless() catch {
        req.deinit();
        return error.FetchFailed;
    };

    var head_buf: [32768]u8 = undefined;
    var response = req.receiveHead(&head_buf) catch {
        req.deinit();
        return error.FetchFailed;
    };
    if (response.head.status != .ok) {
        req.deinit();
        return error.FetchFailed;
    }

    const _dl_io = std.Io.Threaded.global_single_threaded.io();
    var file = std.Io.Dir.createFileAbsolute(_dl_io, dest_path, .{}) catch {
        req.deinit();
        return error.FetchFailed;
    };
    var file_writer_buf: [DOWNLOAD_STREAM_BUFFER_SIZE]u8 = undefined;
    var file_writer = file.writer(_dl_io, &file_writer_buf);
    var reader = response.reader(&.{});

    _ = reader.streamRemaining(&file_writer.interface) catch {
        file.close(_dl_io);
        req.deinit();
        std.Io.Dir.deleteFileAbsolute(_dl_io, dest_path) catch {};
        return error.FetchFailed;
    };
    file_writer.interface.flush() catch {
        file.close(_dl_io);
        req.deinit();
        std.Io.Dir.deleteFileAbsolute(_dl_io, dest_path) catch {};
        return error.FetchFailed;
    };
    file.close(_dl_io);
    req.deinit();
}

/// Download using an existing client while computing SHA256 in the same pass.
pub fn downloadWithClientSha256(
    client: *std.http.Client,
    url: []const u8,
    dest_path: []const u8,
    expected_sha256: []const u8,
) !void {
    return downloadWithClientSha256Headers(client, url, dest_path, expected_sha256, &.{});
}

/// Download with additional headers while computing SHA256 in the same pass.
pub fn downloadWithClientSha256Headers(
    client: *std.http.Client,
    url: []const u8,
    dest_path: []const u8,
    expected_sha256: []const u8,
    extra_headers: []const std.http.Header,
) !void {
    if (expected_sha256.len < 64) return error.ChecksumMismatch;

    const uri = std.Uri.parse(url) catch return error.InvalidUrl;
    var req = client.request(.GET, uri, .{
        // Reduced from 5; HTTPS-to-HTTP downgrade not yet detectable in std.http
        .redirect_behavior = @enumFromInt(3),
        .extra_headers = extra_headers,
    }) catch return error.FetchFailed;

    req.sendBodiless() catch {
        req.deinit();
        return error.FetchFailed;
    };

    var head_buf: [32768]u8 = undefined;
    var response = req.receiveHead(&head_buf) catch {
        req.deinit();
        return error.FetchFailed;
    };
    if (response.head.status != .ok) {
        req.deinit();
        return error.FetchFailed;
    }

    const _dl_io = std.Io.Threaded.global_single_threaded.io();
    var file = std.Io.Dir.createFileAbsolute(_dl_io, dest_path, .{}) catch {
        req.deinit();
        return error.FetchFailed;
    };
    var file_writer_buf: [DOWNLOAD_STREAM_BUFFER_SIZE]u8 = undefined;
    var file_writer = file.writer(_dl_io, &file_writer_buf);
    var reader = response.reader(&.{});
    var hash_buf: [DOWNLOAD_STREAM_BUFFER_SIZE]u8 = undefined;
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    var hashed = reader.hashed(&hasher, &hash_buf);

    _ = hashed.reader.streamRemaining(&file_writer.interface) catch {
        file.close(_dl_io);
        req.deinit();
        std.Io.Dir.deleteFileAbsolute(_dl_io, dest_path) catch {};
        return error.FetchFailed;
    };
    file_writer.interface.flush() catch {
        file.close(_dl_io);
        req.deinit();
        std.Io.Dir.deleteFileAbsolute(_dl_io, dest_path) catch {};
        return error.FetchFailed;
    };
    file.close(_dl_io);
    req.deinit();

    const digest = hasher.finalResult();
    const charset = "0123456789abcdef";
    var hex: [64]u8 = undefined;
    for (digest, 0..) |byte, idx| {
        hex[idx * 2] = charset[byte >> 4];
        hex[idx * 2 + 1] = charset[byte & 0x0f];
    }
    if (!std.mem.eql(u8, &hex, expected_sha256[0..64])) {
        std.Io.Dir.deleteFileAbsolute(_dl_io, dest_path) catch {};
        return error.ChecksumMismatch;
    }
}
