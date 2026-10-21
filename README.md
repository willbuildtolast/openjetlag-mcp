# OpenJetLag MCP

[![CI](https://github.com/willbuildtolast/openjetlag-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/willbuildtolast/openjetlag-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Turn your personal AI agent into a jet lag coach.**

OpenJetLag is an open-source [Model Context Protocol](https://modelcontextprotocol.io) server. Connect it to an agent such as Meta Muse, ChatGPT, Claude or any MCP client, tell the agent about your flight, and it gets a science-based, day-by-day plan: when to seek or avoid light, when to sleep, when to stop caffeine, when not to nap, and optional melatonin timing, from the days before you leave until your body clock matches the destination. Every item has an exact timestamp, so the agent can remind you proactively.

[中文说明](README.zh-CN.md)

```
You ──▶ your agent (Muse, ChatGPT, Claude, …) ──MCP──▶ OpenJetLag server ──▶ @openjetlag/core engine
         conversation, memory, reminders            stateless, stores nothing       pure computation
```

Your agent does the talking, remembering and reminding. This project only supplies the expertise: a deterministic planning engine and guidance on how to use it.

## Connect it to your agent

You need the server's URL. Until the public endpoint is announced here, [deploy your own](#self-hosting) (free on Cloudflare) and use `https://<your-worker>.workers.dev/mcp`.

| Agent | How |
|---|---|
| **Meta Muse** | Settings → Connectors → Add custom connector, paste the URL. Muse connects from Meta's cloud, so the URL must be public HTTPS. |
| **ChatGPT / Dots** | Add it as a custom MCP connector (app) in ChatGPT settings; availability depends on your plan and may require developer mode. Dots use the connectors on your account. |
| **Claude** | Settings → Connectors → Add custom connector, paste the URL. |
| **Any MCP client** | Streamable HTTP transport, URL ending in `/mcp`. No authentication. |

Then just say something like *"I fly from Shanghai to London on Dec 18, 10:00, landing 15:00. Help me with jet lag."*

**Agent Skill (optional, recommended).** [`skills/openjetlag/SKILL.md`](skills/openjetlag/SKILL.md) is a playbook in the open [Agent Skills](https://agentskills.io) format that teaches an agent how to coach: what to ask, how to present the plan, how to schedule reminders and check in. Agents that support skills can install that folder. The server also sends a condensed version as MCP instructions, so agents without skill support behave well too.

## Tools

All tools are read-only and idempotent.

| Tool | What it does |
|---|---|
| `plan_jetlag_trip` | Full plan from flight details and usual sleep times. Returns a readable schedule plus `structuredContent` with summary, days, events and ready-to-schedule `reminders` (exact ISO times, priority, message). `starting_from` returns only what is still ahead ("what should I do now?"). |
| `get_plan_calendar_file` | The same plan as an iCalendar (.ics) file with alerts, for Google, Apple or Outlook calendars or a calendar connector. |
| `explain_jetlag_topic` | Short explanations for "why" questions: overview, light, melatonin, caffeine, naps, direction, flight, safety. |

Inputs to `plan_jetlag_trip`: origin and destination IANA time zones, local departure and arrival date and time, usual bedtime and wake time; optional `pre_trip_days` (default 3), `melatonin` (default true, timing only), `strategy` (`auto`), `language` (`en` or `zh`).

## How the plan works

The engine ([`packages/core`](packages/core)) estimates your body clock from your usual wake time and moves it toward the destination at a realistic pace: about 1 hour per day when shifting earlier (usually eastward) and 1.5 hours per day when shifting later. For large eastward trips it compares both directions and picks the faster one. Light windows are timed to your body clock and only placed while you are awake; sleep moves toward local time after departure; sleep that overlaps the flight becomes in-flight sleep; daylight saving is applied for the actual trip dates. See the [core README](packages/core/README.md) for the model and options.

This is **educational guidance, not medical advice**. Plans never include a melatonin dose, and every response carries safety notes for the agent to show.

## Privacy

- **Stateless:** each request is computed and forgotten. No database, no accounts, no cookies.
- **No content logging:** the server does not log tool arguments (flight details, sleep times) or results.
- Your agent's provider handles your conversation under its own privacy policy. This server only sees the trip details your agent sends in a tool call.

## Self-hosting

**Cloudflare Workers** (free plan: 100,000 requests/day):

```sh
git clone https://github.com/willbuildtolast/openjetlag-mcp && cd openjetlag-mcp
npm install
npx wrangler login
npm run deploy        # prints https://openjetlag-mcp.<you>.workers.dev
```

Your MCP URL is that address plus `/mcp`. `GET /health` returns the version.

To deploy automatically on every push to `main` (after tests pass), add `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID` as repository secrets; see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). A step-by-step guide in Chinese is in [docs/DEPLOY.zh-CN.md](docs/DEPLOY.zh-CN.md).

**Node.js** (any VPS or container, Node 20+):

```sh
npm install && npm run build
PORT=8787 HOST=0.0.0.0 npm start -w @openjetlag/mcp-server
```

Put it behind HTTPS before connecting a cloud-hosted agent. To try it locally, run `npm run dev` and point the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) at `http://127.0.0.1:8787/mcp`.

## Development

```
packages/core/         planning engine (TypeScript, zero dependencies) + unit tests
packages/mcp-server/   MCP server: tools, text rendering, reminders, .ics, HTTP handler
  src/worker.ts        Cloudflare Workers entry
  src/node.ts          Node.js entry
skills/openjetlag/     Agent Skill for coaching behaviour
```

```sh
npm install
npm test          # engine unit tests + end-to-end MCP protocol tests
npm run typecheck
```

Contributions are welcome, especially from people who know circadian science. Please open an issue before large changes to the planning model, and include tests.

## Roadmap

- Public hosted endpoint
- Privacy-preserving usage metrics (aggregate counts only)
- Adaptive re-planning from reported sleep ("I only slept 4 hours")
- Pre-trip shifting that accounts for early departures
- npm package for the engine

## Background

OpenJetLag started as a jet lag web app ([willbuildtolast/openjetlag](https://github.com/willbuildtolast/openjetlag)). This repository refocuses it on agents: the engine was rewritten and the UI dropped, because your agent is now the interface.

## License

[MIT](LICENSE)
