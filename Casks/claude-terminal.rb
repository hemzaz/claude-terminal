cask "claude-terminal" do
  version "1.20.9"
  sha256 "bd83d4a93369e3e33d9aa454c11359244a18ba477310b4fd21dee2a234539978"

  url "https://github.com/hemzaz/claude-terminal/releases/download/v#{version}/ClaudeTerminal_#{version}_aarch64.dmg"
  name "ClaudeTerminal"
  desc "Multi-instance Claude Code terminal manager"
  homepage "https://github.com/hemzaz/claude-terminal"

  depends_on macos: ">= :big_sur"
  depends_on arch: :arm64

  app "ClaudeTerminal.app"

  postflight do
    # App is not notarized — strip the quarantine attribute so
    # Gatekeeper doesn't block first launch.
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/ClaudeTerminal.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/com.claudeterminal.ClaudeTerminal",
    "~/Library/Caches/com.claudeterminal.ClaudeTerminal",
    "~/Library/Preferences/com.claudeterminal.desktop.plist",
  ]
end
