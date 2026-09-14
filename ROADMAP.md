# Roadmap

Best-effort. This UI is the VAST tester at [iab-tech-lab-vast-tester.vastlint.org](https://iab-tech-lab-vast-tester.vastlint.org/) and [vastlint.org/tester](https://vastlint.org/tester/). Spec rules stay in [vastlint](https://github.com/aleksUIX/vastlint).

## Shipped

- vastlint 2.0–4.4 validation, wrapper resolve, playback, tracking waterfall, shareable reports
- Compliance lenses: `strict-iab`, `ctv-safe`, `ssai-safe`, `legacy-player`
- Player profiles: which Linear MediaFile a device would pick (web, IMA, ExoPlayer, Fire TV, Roku RAF, tvOS)
- SIMID studio and CTV Ad Portfolio presets in the tester UI

## Next

### Publisher destination packs

A schema-valid, generic-OTT-legal tag can still miss Netflix. Publisher tables are a destination axis, not VAST schema rules and not player profiles.

Destination dropdown. JSON packs with `official_vendor` citations (Microsoft Learn, Netflix creative specs). Check declared `bitrate`, size, duration, MIME, VPAID, and QR. First packs: generic OTT, Netflix hosted, Roku third-party high.

Do not dump Netflix into `VAST-*-*` IDs. Do not overload `Roku RAF` with the 1,200–2,100 kbps inventory band.

Design: [docs/publisher-packs.md](docs/publisher-packs.md)

## Later

### SIMID fetch and handshake

XML catalog and `--fix` already ship in vastlint. Remaining failures are in the creative HTML. Design lives in [vastlint docs/simid-inspector.md](https://github.com/aleksUIX/vastlint/blob/main/docs/simid-inspector.md).

### Probe declared bitrate

Layer 2 of destination packs: read the fetched media instead of trusting `bitrate="2000"`.
