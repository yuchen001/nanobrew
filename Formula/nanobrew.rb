class Nanobrew < Formula
  desc "The fastest macOS package manager. Written in Zig."
  homepage "https://github.com/justrach/nanobrew"
  license "Apache-2.0"
  version "0.1.078"
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/justrach/nanobrew/releases/download/v0.1.078/nb-arm64-apple-darwin.tar.gz"
      sha256 "a2e0df85f7afcea913edfba29349b1c7ed6d9f4f7105e977c30fa197d030e958"
    else
      url "https://github.com/justrach/nanobrew/releases/download/v0.1.078/nb-x86_64-apple-darwin.tar.gz"
      sha256 "844d708eab7e73eaac7f2b57498547daa7b42ba98aa292282c0c6a54db71a0ee"
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
