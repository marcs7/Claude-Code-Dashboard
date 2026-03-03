# Contributing to CC Dashboard

Thanks for your interest in contributing! This guide covers the workflow and conventions used in this project.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Copy `.env.example` to `.env` and configure for your environment
4. Install dependencies: `npm install`
5. Start the dev server: `npm run dev`

## Branch Naming

Use a prefix that describes the type of change:

- `feature/` — new functionality (e.g. `feature/conversation-tags`)
- `fix/` — bug fixes (e.g. `fix/pagination-off-by-one`)

## Commit Messages

- Use the imperative mood ("Add feature" not "Added feature")
- Keep the first line under 72 characters
- Reference issue numbers when applicable (e.g. `Fix search crash on empty query (#42)`)

## Pull Requests

- Include a clear description of what changed and why
- Test locally before opening a PR (Docker build or `npm run dev`)
- Keep PRs focused — one feature or fix per PR

## Code Style

- **Plain JavaScript** (CommonJS `require`/`module.exports`) — no TypeScript
- **Express + EJS** for server-rendered views
- **Tailwind CSS** via CDN for utility classes — no local CSS build step
- **EJS templates** use `_header.ejs` and `_footer.ejs` partials for shared layout
- No build tooling required — the app runs directly with `node server.js`

## Running Checks

Before submitting a PR, verify the server syntax is valid:

```bash
node --check server.js
node --check src/routes/api.js
node --check src/routes/pages.js
node --check src/services/conversations.js
```

And test the Docker build:

```bash
docker compose up -d --build
curl http://localhost:8502/api/health
```
