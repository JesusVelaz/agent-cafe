# Agent Café

A pixel-art café where you watch your AI agents work. Each agent is a worker in the café, and
where they stand is what they're doing. Hand them work, approve their actions and read their
threads, all in your browser.

```bash
npx agent-cafe
```

That starts the café on this computer and opens http://127.0.0.1:4318. It needs Node 22 or newer.

- **Demo mode** works straight away: scripted agents, no real calls.
- **Live mode** runs the vendors' own coding agents, signed in with your subscription:
  [Claude Code](https://code.claude.com) upstairs and [Codex](https://developers.openai.com/codex)
  downstairs. Install them, then press **Connect** in **Settings → Providers**. Agent Café never
  sees or stores your credentials.

## Options

```
-p, --port <port>     Port to serve the café on (default 4318)
    --data-dir <dir>  Where the café keeps its data (default ~/.agent-cafe)
    --no-browser      Don't open the café in your browser
```

`AGENT_CAFE_PORT` and `AGENT_CAFE_HOME` set the same defaults. The café only listens on this
computer (127.0.0.1).

Source and docs: https://github.com/JesusVelaz/agent-cafe
