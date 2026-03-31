class Nanobrew < Formula
  desc "The fastest macOS package manager. Written in Zig."
  homepage "https://github.com/justrach/nanobrew"
  license "Apache-2.0"
  version "0.1.080"
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/justrach/nanobrew/releases/download/v0.1.080/nb-arm64-apple-darwin.tar.gz"
      sha256 "f33b27661619f8f8015b833081565c8ab28a0ec4b12e90bbf6e71ea2b12ed78d"
    else
      url "https://github.com/justrach/nanobrew/releases/download/v0.1.080/nb-x86_64-apple-darwin.tar.gz"
      sha256 "4747f62fa4b28b59d39c78464aab4a60edd5f110907760cba917ec4f846dd08a"
    end
  end

  def install
    bin.install "nb"
  end

  def post_install
    ohai "Run 'nb init' to create the nanobrew directory tree"
  end

  test do
    assert_match "nanobrew", shell_output("#{bin}/nb help")
  end
end
