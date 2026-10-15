# Browser regression tests

The suite covers validation fixtures, wrapper resolution, editor markers, scenario presets, compliance lenses, declared publisher requirements, playback tracking, SIMID, OM SDK, reports and share links.

```sh
npm ci
npx playwright install chromium
npm run typecheck:e2e
npm test
npm run test:e2e:subpath
```

On Linux CI, use `npx playwright install --with-deps chromium`. To use installed Chrome locally, set `PLAYWRIGHT_CHANNEL=chrome`. Override the port with `PLAYWRIGHT_PORT`. The default is 4173. The suite refuses reuse of an existing server, so results always come from its current source build.

`test:e2e:subpath` repeats the fixture matrix, SIMID cases, share-link round trips and artifact export under `/VAST-Tester/`. Both commands write a separate `dist-e2e/` output and preserve the production `dist/` build.

Remote fixture URLs are intercepted with local XML, media and scripts. Unexpected external requests are refused and recorded. This makes the cases reproducible without depending on ad networks. It does not prove real-device SDK compatibility or every third-party creative.

The initialization regressions compile the actual `SimidPlayer` source, then exercise it in a browser with a synthetic iframe message source. They check delayed acceptance, rejection and an absent acknowledgment. The UI tests additionally exercise the bundled IAB creatives and pod and wrapper scenarios.

Add regression cases for behavior changes. Preserve specific error IDs, media selection and message ordering assertions. Generated reports and recordings remain ignored; test source and fixtures are committed.
