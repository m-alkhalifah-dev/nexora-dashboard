# NEXORA — Hermes mission-control dashboard plugin

Free NEXORA-style mission control for `hermes dashboard`. Canonical source; the live copy is at
`C:\Users\m\AppData\Local\hermes\plugins\nexora\`.

## What it shows
- Overview stat tiles (agents, heavy/27B agents, agents with MCP, wiki-lesson coverage, kanban activity, cron ticker).
- Live roster of every profile grouped by category: model (colour by tier), toolset count, MCP servers, shell hooks, wiki-lesson badge, fallbacks.
- Shared wiki memory: hot.md, topic chips, recent changes.
- Kanban work: status counts + recent tasks.
Polls every 12s. Backend reads disk directly (profile configs, kanban.db, D:\Projects\_wiki); read-only.

## Install / update
Copy this folder to `%LOCALAPPDATA%\hermes\plugins\nexora\`, then:
    curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
or restart `hermes dashboard`. Open the dashboard -> NEXORA tab.

Override wiki path with env HERMES_WIKI_DIR (default D:\Projects\_wiki).
