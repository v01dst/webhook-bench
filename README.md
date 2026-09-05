<div align="center">

# 🪝 webhook-bench

**Catch, inspect and clear any webhook. Debug integrations in seconds, not hours.**

[![CI](https://github.com/v01dst/webhook-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/v01dst/webhook-bench/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-8A2BE2)
![Node](https://img.shields.io/badge/node-22-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/sqlite-WAL-003B57?logo=sqlite&logoColor=white)
![Tests](https://img.shields.io/badge/tests-10%20passing-brightgreen)

`github` · `stripe` · `slack` · `any integration` · `any payload`
</div>

---

## ✨ Features

- **🪝 One-URL catcher** — create a bench, point any webhook at it, any method, any path
- **🔍 Full inspection** — headers, query strings, body (text *and* binary base64)
- **🗄️ Persistent history** — SQLite storage, 24h retention, newest-first
- **🧹 One-call cleanup** — clear events or nuke the whole hook
- **📏 Body size guards** — 256 KB cap with clean 413s
- **🐳 One-command deploy** — Docker with persistent volume

## 🚀 Quick Start

```bash
git clone https://github.com/v01dst/webhook-bench
cd webhook-bench
npm ci
npm start
```

Or with Docker:

```bash
docker compose up -d
```

## 📡 API

| Method   | Route                     | Description              |
|----------|---------------------------|--------------------------|
| `POST`   | `/hooks`                  | Create a catch bench     |
| `ANY`    | `/hook/:id`               | Catch anything sent here |
| `GET`    | `/hooks/:id/events`       | List captured events     |
| `GET`    | `/hooks/:id/events/:eid`  | One event, decoded body  |
| `DELETE` | `/hooks/:id/events`       | Clear events             |
| `DELETE` | `/hooks/:id`              | Delete hook + events     |
| `GET`    | `/health`                 | Liveness                 |

### Workflow

```bash
# 1. create a bench
curl -X POST http://localhost:3000/hooks
# → {"id":"rqia9bl1qs2z","url":"/hook/rqia9bl1qs2z",...}

# 2. point your webhook at it (github, stripe, anything)
curl -X POST http://localhost:3000/hook/rqia9bl1qs2z \
  -H 'content-type: application/json' \
  -d '{"event":"push","repo":"v01dst/url-shortener"}'
# → {"ok":true}

# 3. inspect what arrived
curl http://localhost:3000/hooks/rqia9bl1qs2z/events
```

```json
{
  "count": 1,
  "events": [
    {
      "id": 1,
      "received_at": "2026-09-04T05:50:35.982Z",
      "method": "POST",
      "path": "/hook/rqia9bl1qs2z",
      "headers": { "user-agent": "curl/8.18.0", "content-type": "application/json" },
      "body_size": 46
    }
  ]
}
```

## ⚙️ Configuration

| Variable         | Default                  | Description            |
|------------------|--------------------------|------------------------|
| `PORT`           | `3000`                   | Listen port            |
| `DB_PATH`        | `./data/webhooks.db`     | SQLite file            |
| `MAX_BODY_BYTES` | `262144`                 | Max captured body      |
| `RETENTION_HOURS`| `24`                     | Event retention        |

## 🧱 Tech Stack

| Layer     | Tech                |
|-----------|---------------------|
| Runtime   | Node.js 22          |
| Language  | TypeScript (strict) |
| Framework | Fastify 5           |
| Storage   | SQLite (WAL)        |
| Testing   | Vitest 5            |
| Packaging | Docker + compose    |
| CI        | GitHub Actions      |

---

<div align="center">

Built with ⚡ by **v01dst**

[![GitHub](https://img.shields.io/badge/github-v01dst-181717?logo=github)](https://github.com/v01dst)
[![Discord](https://img.shields.io/badge/discord-9p.1-5865F2?logo=discord&logoColor=white)](https://discord.com/users/9p.1)

</div>
