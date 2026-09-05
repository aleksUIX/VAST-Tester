# VAST Tester AleksUIX

**Live: [iab-tech-lab-vast-tester.vastlint.org](https://iab-tech-lab-vast-tester.vastlint.org/)**

IAB-style VAST tester and SIMID studio. A modern, vastlint-powered VAST validator, debugger, and QA workbench. Not an IAB Tech Lab product.

If you are looking for a new and improved alternative to the IAB Tech Lab VAST Tester, this repository is meant to be that starting point. It keeps the familiar idea of a browser-based VAST tester, but adds deeper validation, wrapper inspection, playback diagnostics, tracking visibility, and shareable findings for real ad-tech workflows.

This project is built on top of [`vastlint`](https://github.com/aleksUIX/vastlint), the Rust-based VAST validation engine behind [vastlint.org](https://vastlint.org). It is an independent open-source project and is not affiliated with or endorsed by IAB Tech Lab.

## Looking for the IAB Tech Lab VAST Tester?

If that search term brought you here, the short version is this: this repo is an open-source, modernized VAST tester built for teams who want more than a legacy pass/fail checker.

It is designed for buyers, sellers, SSPs, DSPs, SSAI teams, QA engineers, and ad-ops workflows that need to:

- validate VAST XML against the IAB VAST specification
- inspect wrapper chains and resolved ads in detail
- understand tracking, macro expansion, and playback behavior
- share findings quickly with partners, vendors, or internal engineering teams

## What This Repo Does

- Validate pasted VAST XML or a remote VAST URL
- Auto-fix deterministic issues that `vastlint` can repair
- Resolve wrapper chains through `vastlint-client`
- Inspect wrapper hops, resolved ads, media files, and rule findings in one UI
- Display findings inline while editing XML
- Review playback-oriented runtime signals, tracking waterfalls, and macro previews
- Switch between different compliance-oriented validation profiles
- Export reports and copy error summaries for partner debugging

## Built on `vastlint`

This UI is the interactive frontend layer for the broader `vastlint` ecosystem.

- Core project: [github.com/aleksUIX/vastlint](https://github.com/aleksUIX/vastlint)
- Hosted web validator: [vastlint.org](https://vastlint.org)
- Report an issue: [github.com/aleksUIX/vastlint/issues](https://github.com/aleksUIX/vastlint/issues)
- Start a discussion: [github.com/aleksUIX/vastlint/discussions](https://github.com/aleksUIX/vastlint/discussions)
- npm packages:
	- [npmjs.com/package/vastlint](https://www.npmjs.com/package/vastlint)
	- [npmjs.com/package/vastlint-client](https://www.npmjs.com/package/vastlint-client)
	- [npmjs.com/package/vastlint-react](https://www.npmjs.com/package/vastlint-react)

Use this repo when you want a browser-first debugging workflow. Use `vastlint` directly when you want CLI automation, CI checks, MCP integration, or to embed VAST validation inside another system.

SIMID is split the same way. `vastlint` checks the VAST envelope (`type`, `apiFramework`, HTTPS, fallback media). Fetching the creative HTML, reading frame headers, and (later) driving `createSession` belong here. A tag that is XML-clean and still dies in the player is tester work, not a bid-time verdict.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

## Deploy

This repo is intended to stay separate from `vastlint-infra` and deploy directly to Cloudflare Pages on the custom hostname `iab-tech-lab-vast-tester.vastlint.org`.

One-time Cloudflare auth on your machine:

```bash
npm run cf:login
```

One-time Pages project creation:

```bash
npm run cf:pages:create
```

Deploy the current branch from your local machine:

```bash
npm run deploy:pages
```

After the first successful deploy, attach the custom domain in Cloudflare Pages:

```text
iab-tech-lab-vast-tester.vastlint.org
```

This workflow avoids GitHub Actions and repo secrets while keeping deployment repeatable from the local CLI.

## Why This Exists

The goal is not to reproduce the old tester one-to-one. The goal is to provide a stronger open-source workflow for anyone searching for an IAB Tech Lab VAST Tester style tool, but needing more visibility into why a tag fails, how wrappers resolve, what media is actually returned, and where tracking or compliance issues appear.

## Feedback, Issues, Questions

All feedback goes through the `vastlint` GitHub project, since this tester is a frontend for that engine:

- Wrong or missing validation result, rule request, tester bug: [open an issue](https://github.com/aleksUIX/vastlint/issues/new)
- Questions, ideas, anything open-ended: [start a discussion](https://github.com/aleksUIX/vastlint/discussions)

## Notes

- The app installs `vastlint`, `vastlint-client`, and `vastlint-react` directly from npm.
- For URL-backed validation, the target endpoint must allow browser-side fetching from your local dev or deployed origin.
- Browser playback results can vary based on codec support and remote asset permissions.
