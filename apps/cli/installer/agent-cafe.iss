; Windows installer for Agents Café, built with Inno Setup 6 by the release workflow:
;   iscc /DAppVersion=0.2.1 /DSourceDir=..\release\agent-cafe /O..\release agent-cafe.iss
; SourceDir is the folder `pnpm --filter ./apps/cli standalone` builds. People get Start menu
; (and optionally desktop) shortcuts, no Node or pnpm needed. Installing asks for admin once so it
; can also let phones on the home network reach the café (Private networks, local subnet only).

#ifndef AppVersion
  #error Pass /DAppVersion=<version>
#endif
#ifndef SourceDir
  #error Pass /DSourceDir=<standalone app folder>
#endif

#define AppName "Agents Café"
#define FirewallRule "Agents Café (network access)"
; Names from before the rename to Agents Café, cleaned up on upgrade.
#define OldFirewallRule "Agent Café (network access)"
#define OldAppName "Agent Café"

[Setup]
AppId={{6F0B8C2E-4D1A-4E7B-9C35-2A8E5D9B7C41}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Agents Café
AppPublisherURL=https://github.com/JesusVelaz/agent-cafe
DefaultDirName={autopf}\Agents Cafe
DefaultGroupName={#AppName}
UsePreviousGroup=no
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=AgentCafeSetup
SetupIconFile=agent-cafe.ico
UninstallDisplayIcon={app}\agent-cafe.ico
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
; Upgrading over a running café: ask to close it, and don't restart it behind the person's back.
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Add a desktop shortcut"
Name: "phones"; Description: "Let phones on my home Wi-Fi open the café (adds a Windows Firewall rule for private networks only)"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "agent-cafe.ico"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; Shortcuts from before the rename.
Type: filesandordirs; Name: "{autoprograms}\{#OldAppName}"
Type: files; Name: "{autodesktop}\{#OldAppName}.lnk"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\agent-cafe.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\agent-cafe.ico"; Comment: "Open Agents Café in your browser"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\agent-cafe.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\agent-cafe.ico"; Comment: "Open Agents Café in your browser"; Tasks: desktopicon
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; The rule the café's own "Fix it" (Settings → Connections) adds, by the same name, so either replaces
; the other. It covers any port, since the café moves off 4318 when another program holds it.
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ""Remove-NetFirewallRule -DisplayName '{#FirewallRule}', '{#OldFirewallRule}' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '{#FirewallRule}' -Direction Inbound -Action Allow -Protocol TCP -Program '{app}\node.exe' -Profile Private -RemoteAddress LocalSubnet | Out-Null"""; Flags: runhidden waituntilterminated; StatusMsg: "Letting phones on your home Wi-Fi reach the café..."; Tasks: phones
Filename: "{app}\agent-cafe.cmd"; WorkingDir: "{app}"; Description: "Open {#AppName} now"; Flags: postinstall nowait skipifsilent shellexec runasoriginaluser

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ""Remove-NetFirewallRule -DisplayName '{#FirewallRule}', '{#OldFirewallRule}' -ErrorAction SilentlyContinue"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewallRule"
