# Roadmap

This browser tester uses the published vastlint packages for specification validation. Runtime diagnostics and publisher destination packs live in this repository.

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