# Roadmap

Best-effort. This UI is the VAST tester at [iab-tech-lab-vast-tester.vastlint.org](https://iab-tech-lab-vast-tester.vastlint.org/) and [vastlint.org/tester](https://vastlint.org/tester/). Spec rules stay in [vastlint](https://github.com/aleksUIX/vastlint).

## Shipped

- vastlint 2.0–4.4 validation, wrapper resolve, playback, tracking waterfall, shareable reports
- Compliance lenses: `strict-iab`, `ctv-safe`, `ssai-safe`, `legacy-player`
- Player profiles: which Linear MediaFile a device would pick (web, IMA, ExoPlayer, Fire TV, Roku RAF, tvOS)
- SIMID studio and CTV Ad Portfolio presets in the tester UI
- Publisher destination packs: declared-XML eligibility for generic OTT, Netflix hosted, Roku / ESPN / NBCU hosted and third-party, and Hulu. Destination dropdown. `DEST-*` findings. QR ban on Netflix. Mezzanine nodes, bitrate-unit, H.264 codec family, size probe warning. Not a publisher cert.

## Later

### SIMID fetch and handshake

XML catalog and `--fix` already ship in vastlint. Remaining failures are in the creative HTML. Design lives in [vastlint docs/simid-inspector.md](https://github.com/aleksUIX/vastlint/blob/main/docs/simid-inspector.md).

### Encode probe

Size vs duration is shipped as a warning. Reading the actual encode (SPS, audio 48 kHz) is still later.

### CLI `--destination`

Allowlisted CI later. Not default `check`. Not grpc.