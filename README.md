# IAB Tech Lab VAST Tester

Browser-based VAST validation, wrapper inspection, playback diagnostics, tracking reports, SIMID host testing and OM SDK sessions. The original tester was contributed by DoubleVerify. This rewrite uses the Apache-2.0 licensed `vastlint`, `vastlint-client` and `vastlint-react` packages, pinned to 0.15.0.

## Development

Use Node 22.16.0 from `.nvmrc` or `.node-version`. The build requires Node 22.12.0 or newer. CI also checks Node 24.

```sh
npm ci
npm run dev
```

```sh
npm run typecheck:e2e
npm run build
npx playwright install chromium
npm test
npm run test:e2e:subpath
```

The test commands build and serve a separate `dist-e2e/` directory. Production output remains in `dist/`. See [e2e/README.md](e2e/README.md) for fixtures and browser setup.

## Supported workflows

- Paste VAST XML or fetch a VAST URL directly from the browser.
- Validate and apply deterministic repairs.
- Resolve wrappers and inspect ads, media, verification resources and tracking targets.
- Compare compliance lenses and player media preferences.
- Exercise SIMID initialization, playback controls and per-ad interactions.
- Start OM SDK sessions using the included IAB Web SDK fixtures.
- Inspect publisher destination packs and export evidence bundles or share links.

The VAST 4.4 scenarios exercise draft features. Publisher packs check the declared tag against their cited requirements; they do not certify publisher acceptance. Player profiles rank media preferences in this browser. They do not run actual Roku, Fire TV, tvOS, ExoPlayer or IMA SDKs.

## Network behavior

There is no sample collection, analytics or server proxy. Validation and repair run locally through WASM. URL loading, wrapper resolution, creative inspection and media playback require the target server to allow access from this origin. A CORS-blocked tag can be pasted as XML; referenced wrappers and assets still require network access.

Built-in fixture URLs resolve to this deployment, including a configured base path. Tracking and verification requests come from the tested tag and the operator's selected actions. They are separate from application telemetry.

## Deployment

`npm run build` produces a static `dist/` directory. Serve it with its assets and WASM file from the configured origin. For a subpath, build with `npx vite build --base=/VAST-Tester/`.

GitHub Actions validates pull requests on Node 22 and 24, including a root build and subpath browser checks. It does not deploy.

The updated CircleCI configuration preserves upstream's existing branch destinations: `vasttester-origin-master.iabtechlab.com`, `vasttester-origin-candidate.iabtechlab.com` and `vasttester-origin-release.iabtechlab.com`. It uploads `dist/` only after build and browser checks pass, and excludes pull requests and other branches. IAB must verify its current CircleCI AWS credentials, bucket ownership and hosting configuration before using that deployment path. No credentials or account-specific Cloudflare configuration are included.

## Contributing

Report tester issues in [IABTechLab/VAST-Tester](https://github.com/IABTechLab/VAST-Tester/issues). Review the [IAB Tech Lab open source governance guidelines](https://iabtechlab.com/opensource/) before contributing. Changes to the validation engine belong in its [source repository](https://github.com/aleksUIX/vastlint).

## License

Apache License 2.0. Copyright 2021 IAB Technology Laboratory, Inc. The vendored IAB SIMID samples and Blender video crops retain their notices in `public/fixtures/`.
