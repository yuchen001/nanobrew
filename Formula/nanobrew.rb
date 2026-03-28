class Nanobrew < Formula
  desc "The fastest macOS package manager. Written in Zig."
  homepage "https://github.com/justrach/nanobrew"
  license "Apache-2.0"
  version "0.1.077"
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/justrach/nanobrew/releases/download/v0.1.077/nb-arm64-apple-darwin.tar.gz"
      sha256 "3a69851ba81f9fff14ea3f341380c00490127170555cf602eedb1cf6e939909e"
    else
      url "https://github.com/justrach/nanobrew/releases/download/v0.1.077/nb-x86_64-apple-darwin.tar.gz"
      sha256 "049df569ed1bab3b901498f900519a94e8dfd19975cf1fd6e3ecc9fba7c9da31"
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
