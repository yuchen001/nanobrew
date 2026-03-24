# nanobrew Twitter/X Thread

---

**1/**

I built a package manager that installs software 10-500x faster than Homebrew.

It's 1.2 MB. Written in Zig. Zero dependencies.

It's called nanobrew, and here's how it works.

---

**2/**

The problem: `brew install tree` takes 5.5 seconds for a 60KB binary.

Most of that is Ruby startup, curl subprocesses, and sequential operations.

nanobrew does the same install in 10ms cold, 3.5ms warm.

That's not a typo.

---

**3/**

Homebrew ships a 57 MB Ruby runtime. It shells out to curl for every download. It reads files twice — once to download, once to hash.

nanobrew is a 1.2 MB static binary. Native HTTP. Streaming SHA256 that verifies while downloading. No subprocesses. Ever.

---

**4/**

The install pipeline:

Resolve deps (parallel BFS)
→ Download + SHA256 (streaming, concurrent)
→ Extract via mmap
→ Store by content hash
→ APFS clonefile into Cellar

Everything runs in parallel. Downloads, extraction, dependency resolution — all concurrent.

---

**5/**

The key innovation: content-addressable storage + APFS clonefile.

Package data lives in a SHA256-keyed store. Installing means creating a zero-copy reference via macOS's clonefile syscall.

No data moves. No disk cost. That's why warm installs take 3.5ms.

---

**6/**

Native everything:

- Native HTTP (no curl subprocess)
- Native Mach-O parsing (no otool)
- Native ELF parsing (no patchelf)
- Native ar + zstd + gzip (no tar subprocess)
- Arena allocators (zero heap allocs on hot path)

Zero subprocess spawning is where the speed comes from.

---

**7/**

Real benchmarks on Apple Silicon, macOS 15:

tree (0 deps, cold): brew 8.99s → nb 1.19s (7.6x faster)
wget (6 deps, cold): brew 16.84s → nb 11.26s (1.5x faster)
ffmpeg (11 deps, warm): brew ~24.5s → nb 3.5ms (7,000x faster)

---

**8/**

It's not just macOS.

nanobrew does native .deb extraction on Linux — 2.8x faster than apt-get in Docker.

Perfect for CI containers where apt-get is painfully slow.

---

**9/**

What can it actually do?

- Everything brew does: install, upgrade, uninstall, list
- Third-party taps: `nb install user/tap/formula`
- Casks: .dmg, .pkg, .zip macOS apps
- Source builds: cmake, autotools, meson, make
- Services: launchctl (macOS) + systemd (Linux)
- rollback, pin/unpin, doctor, cleanup, bundle export
- Shell completions: zsh, bash, fish

---

**10/**

"Can I use it alongside Homebrew?"

Yes. nanobrew installs to /opt/nanobrew/, completely separate from /opt/homebrew/. Run both side by side.

It uses the same Homebrew formulae and bottle infrastructure. `nb install tree` works exactly like `brew install tree`.

---

**11/**

It's experimental but it works well for common packages.

Try it:

```
curl -fsSL https://nanobrew.trilok.ai/install | bash
```

GitHub: github.com/justrach/nanobrew

Would love feedback. Star it if you think package managers should be fast.
