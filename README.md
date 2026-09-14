# VAST Tester

Browser-based VAST tester for IAB Tech Lab. Validate VAST XML, resolve wrapper chains, inspect media and tracking, and exercise SIMID and OM SDK sessions.

## What it does

- Validate pasted VAST XML or a remote VAST URL
- Auto-fix deterministic issues
- Resolve wrapper chains
- Inspect hops, resolved ads, media files, and rule findings
- Review playback, tracking waterfalls, and macro expansion
- Switch compliance-oriented validation profiles
- Export reports for partner debugging

## Getting started

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Remote URL fetches run in the browser. The target endpoint must allow CORS from this origin.

## Notes

- Node 18 or newer
- Browser playback depends on codec support and remote asset permissions
