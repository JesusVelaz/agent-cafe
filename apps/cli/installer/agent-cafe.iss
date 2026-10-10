; Windows installer for Agent Café, built with Inno Setup 6 by the release workflow:
;   iscc /DAppVersion=0.1.0 /DSourceDir=..\release\agent-cafe /O..\release agent-cafe.iss
; SourceDir is the folder `pnpm --filter ./apps/cli standalone` builds. People get Start menu
; (and optionally desktop) shortcuts, no Node or pnpm needed. Installing asks for admin once so it
; can also let phones on the home network reach the café (Private networks, local subnet only).

#ifndef AppVersion
  #error Pass /DAppVersion=<version>
#endif
#ifndef SourceDir
  #error Pass /DSourceDir=<standalone app folder>
#endif

#define AppName "Agent Café"
#define FirewallRule "Agent Café (phone access)"

[Setup]
AppId={{6F0B8C2E-4D1A-4E7B-9C35-2A8E5D9B7C41}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Agent Café
AppPublisherURL=https://github.com/JesusVelaz/agent-cafe
DefaultDirName={autopf}\Agent Cafe
DefaultGroupName={#AppName}
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

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\agent-cafe.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\agent-cafe.ico"; Comment: "Open Agent Café in your browser"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\agent-cafe.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\agent-cafe.ico"; Comment: "Open Agent Café in your browser"; Tasks: desktopicon
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; The same rule the café's own "Fix it" button adds, so either one finds the other's.
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ""Remove-NetFirewallRule -DisplayName '{#FirewallRule}' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '{#FirewallRule}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4318 -Program '{app}\node.exe' -Profile Private -RemoteAddress LocalSubnet | Out-Null"""; Flags: runhidden waituntilterminated; StatusMsg: "Letting phones on your home Wi-Fi reach the café..."; Tasks: phones
Filename: "{app}\agent-cafe.cmd"; WorkingDir: "{app}"; Description: "Open {#AppName} now"; Flags: postinstall nowait skipifsilent shellexec runasoriginaluser

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ""Remove-NetFirewallRule -DisplayName '{#FirewallRule}' -ErrorAction SilentlyContinue"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewallRule"
