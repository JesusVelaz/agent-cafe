# Subscription harnesses (replaces API keys)

Status: approved 2026-09-27. Supersedes the API-key parts of the design spec (§ keys, vault, daily caps).

## Decision

Agents Café never holds credentials. Each floor is driven by a *harness*: the vendor's own
coding agent, installed and signed in by the user with the vendor's own login flow.

| Floor | Provider | Harness | How we drive it | Sign-in |
|---|---|---|---|---|
| Upstairs | Anthropic | Claude Code | `@anthropic-ai/claude-agent-sdk` `query()`, running the user's installed `claude` | `claude auth login` |
| Ground | OpenAI | Codex (next) | `codex app-server` (JSON-RPC over stdio) | `codex login` |

Why this is allowed: Claude Code's terms permit an end user to sign in to the unmodified
Claude Code binary with their own subscription. We never offer a claude.ai login, never read,
store or forward tokens, and strip `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the child
environment so runs always bill the user's plan. Usage counts against the plan's normal limits.

Build order: Claude Code first, Codex second. Demo (mock) mode stays for both floors.

## Behaviour

- **Connection.** The server checks `claude auth status` (JSON) and `claude --version` on boot and
  on "Check again". States: `ready` (email + plan), `signed_out`, `not_installed`, `unsupported`
  (Codex until it lands), `error`. A floor can go Live only when `ready`.
- **Agents** gain a working folder (`workDir`, absolute, must exist) and a permission setting:
  `ask` (default: Claude Code asks before edits and commands) or `acceptEdits` (file edits run
  without asking; commands still ask). Tasks for a Live agent without a folder are refused.
- **Models** come from the harness (`supportedModels()`), so the picker always matches what the
  signed-in plan offers. Aliases (`opus`, `sonnet`, `haiku`) and full ids both work.
- **Approvals.** Claude Code's permission prompts arrive through `canUseTool`. The task gets a
  `pendingApproval` (tool, one-line summary, reason); it shows as an Allow / Deny card under
  "Needs you" and as a raised-hand bubble in the café. Cancelling the task denies it.
  `AskUserQuestion` is answered automatically with "no interactive questions, choose sensibly".
- **Events.** Tool calls map onto the existing `tool.start` / `tool.end` events with the harness's
  own tool names (Read, Edit, Bash…); the café maps names to stations. Streaming text uses
  `model.delta`; each assistant message is a step.
- **Money.** Subscription runs have no dollar cost (`costUsd` null) and no per-task budget or daily
  cap; guardrails are `maxTurns` and the plan's own limits. The top bar shows the plan's current
  rate-limit window (from the SDK's `rate_limit_event`) instead of spend. Demo runs keep their
  simulated prices and budgets.
- **Sessions** are not persisted to the user's Claude Code history (`persistSession: false`).

## Out of scope (for now)

Codex harness; follow-up messages into a finished session; "always allow" rules; a native
folder picker (the folder is typed or pasted).
