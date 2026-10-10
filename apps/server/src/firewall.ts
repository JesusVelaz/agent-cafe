/**
 * Windows Firewall, the usual reason a phone can't reach the café: the first time Node listens
 * on the network, Windows asks, and the answer often leaves phones out. Allowing covers Private
 * networks only, while Windows marks new Wi-Fi as Public; Cancel adds a rule that blocks Node.
 * The phone just loads until it times out. This finds those cases, and fixes them behind
 * Windows' own admin prompt (changing firewall settings needs it).
 */
import { execFile } from 'node:child_process';

/** What stands between a phone and the café (null: nothing we can see). */
export interface FirewallProblem {
  /** `blocked`: a rule blocks Node. `not-allowed`: no rule lets it in, so the firewall drops it. */
  kind: 'blocked' | 'not-allowed';
  /** How Windows classes the network the café listens on. */
  network: 'Public' | 'Private' | 'DomainAuthenticated' | null;
  /** Whether "Fix it" can repair it. Not on work-managed (domain) networks: those are IT's call. */
  fixable: boolean;
}

export type PowerShell = (script: string, timeoutMs?: number) => Promise<string>;

/** Runs a PowerShell script and returns what it prints. */
export const powershell: PowerShell = (script, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });

/** A PowerShell string literal. */
export const psString = (s: string) => `'${s.replace(/'/g, "''")}'`;

const RULE_NAME = 'Agent Café (phone access)';

/** Finds the network category and the inbound rules that decide whether Node is let in on `port`. */
export function checkScript(address: string, port: number, node: string): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$node = ${psString(node)}; $port = '${port}'
$cat = $null
$ip = Get-NetIPAddress -IPAddress ${psString(address)} | Select-Object -First 1
if ($ip) { $cat = [string]((Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex | Select-Object -First 1).NetworkCategory) }
$profileName = if ($cat -eq 'DomainAuthenticated') { 'Domain' } elseif ($cat) { $cat } else { 'Public' }
$enabled = [bool]((Get-NetFirewallProfile -Name $profileName).Enabled)
$rules = @(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and [Environment]::ExpandEnvironmentVariables($_.Program) -ieq $node } | Get-NetFirewallRule)
$rules += @(Get-NetFirewallPortFilter -Protocol TCP | Where-Object { @($_.LocalPort) -contains $port } | Get-NetFirewallRule)
$rules = @($rules | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and ($_.Profile.ToString() -eq 'Any' -or $_.Profile.ToString() -match $profileName) })
@{
  network = $cat
  enabled = $enabled
  block = @($rules | Where-Object { $_.Action -eq 'Block' }).Count
  allow = @($rules | Where-Object { $_.Action -eq 'Allow' }).Count
} | ConvertTo-Json -Compress
`;
}

/** Reads the check's output into a problem, or null when the way in looks open. */
export function readCheck(output: string): FirewallProblem | null {
  // The JSON is the last line; PowerShell may print other things first.
  const line = output.trim().split(/\r?\n/).at(-1) ?? '';
  const r = JSON.parse(line) as { network: string | null; enabled: boolean; block: number; allow: number };
  if (!r.enabled) return null;
  const network = r.network === 'Public' || r.network === 'Private' || r.network === 'DomainAuthenticated' ? r.network : null;
  const fixable = network === 'Public' || network === 'Private';
  if (r.block > 0) return { kind: 'blocked', network, fixable };
  if (r.allow === 0) return { kind: 'not-allowed', network, fixable };
  return null;
}

/**
 * Lets phones on the home network in: marks the network Private (if Windows calls it Public),
 * turns off rules that block Node there, and allows Node on the café's port from the local subnet
 * only, on Private networks only. Runs elevated, so Windows asks the person first.
 */
export function fixScript(address: string, port: number, node: string): string {
  const inner = `
$ErrorActionPreference = 'Stop'
$node = ${psString(node)}
$ip = Get-NetIPAddress -IPAddress ${psString(address)} | Select-Object -First 1
$conn = Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex | Select-Object -First 1
if ($conn.NetworkCategory -eq 'Public') { Set-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex -NetworkCategory Private }
Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and [Environment]::ExpandEnvironmentVariables($_.Program) -ieq $node } | Get-NetFirewallRule |
  Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and ($_.Profile.ToString() -eq 'Any' -or $_.Profile.ToString() -match 'Private') } |
  Disable-NetFirewallRule
Remove-NetFirewallRule -DisplayName ${psString(RULE_NAME)} -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName ${psString(RULE_NAME)} -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Program $node -Profile Private -RemoteAddress LocalSubnet | Out-Null
`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  // The outer script only asks Windows to run the inner one as administrator, and waits for it.
  return `
$ErrorActionPreference = 'Stop'
$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'
exit $p.ExitCode
`;
}

/** The firewall check, on Windows only (elsewhere the firewall rarely gets in the way, and asks clearly when it does). */
export async function checkFirewall(address: string, port: number, run: PowerShell = powershell, platform = process.platform): Promise<FirewallProblem | null> {
  if (platform !== 'win32') return null;
  try {
    return readCheck(await run(checkScript(address, port, process.execPath)));
  } catch {
    return null; // Can't tell: say nothing rather than guess.
  }
}

/** Runs the fix. Rejects if the person said no to Windows' prompt, or the fix failed. */
export async function fixFirewall(address: string, port: number, run: PowerShell = powershell): Promise<void> {
  await run(fixScript(address, port, process.execPath), 5 * 60_000); // the person has to answer Windows' prompt
}
