# Publisher destination packs

A schema-valid, generic-OTT-legal VAST tag can still be ineligible for Netflix. That is not a VAST spec miss. It is a publisher table.

Player profiles answer which MediaFile a device would pick. Compliance lenses change IAB rule severity. Neither is Netflix's H.264 floor, Roku's third-party high band, or a QR ban.

Not a publisher cert. Microsoft tables change. Report what this pack, on this cited document, says about the declared tag. Do not stamp Netflix approved.

## Placement

XML schema lives in vastlint-core. Destination packs do not.

`vastlint-core` stays spec-backed (XSD/PDF). Default `check`, RapidAPI, and grpc stay on IAB rules. Publisher kbps is not a `VAST-4.x-*` rule ID.

The product is the VAST tester:

- https://vastlint.org/tester/
- https://iab-tech-lab-vast-tester.vastlint.org/

The tester UI already has two extra lenses. Add a third:

| Axis | What it is | What it is not |
|---|---|---|
| Spec / vastlint-core | VAST structure | Publisher bitrate |
| Compliance lens | IAB severity (`ctv-safe`, `ssai-safe`) | Netflix QR ban |
| Player profile | Device MIME pick (`Roku RAF`, Fire TV) | Roku inventory 1,200–2,100 kbps |
| Destination pack | Publisher eligibility | Device playback |

Do not overload `Roku RAF` with the publisher band. Device MIME ≠ inventory contract.

CLI `--destination` is not the first ship. Add it later if a CI team asks. Do not put publisher tables in grpc.

## Pack shape

JSON, pixellint-shaped: `id`, `display_name`, `source_level: official_vendor`, cited `docs` URL, `contract` (`hosted` or `third_party`). A pack without a citation does not compile.

First cut is declared XML only:

- `MediaFile` `bitrate` / `minBitrate` / `maxBitrate`
- `width`, `height`, `type`
- Linear `Duration`
- `apiFramework` VPAID
- QR-like Icon, Companion, or CreativeExtension when the pack forbids QR

Hosted vs third-party are different packs. Hosted Roku is ≥2,100 kbps. Third-party Roku high is 1,200–2,100 kbps. Mixing them is a false fail.

## Layer 1: declared tag

Walk Linear MediaFiles against the selected pack. Fail closed on missing `bitrate` when the pack requires a floor or a band.

Netflix (Microsoft hosted table): H.264 720p >8,000 kbps, 1080p >12,000; MOV 42,000 / 80,000; durations 10 / 15 / 30 / 60 (20s Spain only); 48 kHz stereo when declared; no QR.

Generic OTT (Microsoft Invest): VAST, MP4, ≥2,000 kbps, ≥720p, 15 or 30s, no VPAID.

Roku / ESPN / NBCU / Hulu: Microsoft Monetize third-party rendition tables. NBCU requires the full rendition set.

Cite:

- https://learn.microsoft.com/en-us/xandr/invest/ott-video-creative-specifications
- https://learn.microsoft.com/en-us/xandr/monetize/creative-ctv-guidelines-and-specifications
- https://advertising.netflix.com/en-us/creative-specs

Rule IDs in a `DEST-*` prefix so they do not collide with the VAST catalog. They are not in `CATALOG`. First cut is tester-only.

## Layer 2: probe the file

Later. The tester already fetches media for playback. Declared `bitrate="2000"` can lie. Probe is a second pass, behind an explicit control. Do not block layer 1 on it. Do not claim the encode without reading the file.

## UI

Destination dropdown next to the player profile and the compliance lens. Default is none (spec + player only). Selecting Netflix does not change IAB severities. It adds destination findings.

Export includes the pack id and the cited URL.

## Out of scope

- Player support matrices (already player profiles)
- Pause ads as JPEG, or any Streamhaus / AdCP toy product
- Claiming Netflix, Hulu, or Microsoft adopted vastlint
- IAB Ad Format Guidelines v2.0 as a substitute for publisher tables (different document)
- Rewriting someone else's MediaFile
- Default `check`, RapidAPI, or grpc

## Ship order

1. Pack format + Destination dropdown + generic OTT + Netflix hosted + Roku third-party high
2. ESPN, NBCU, Hulu packs, including NBCU four-file set
3. QR scan on packs that forbid it
4. Optional probe of the fetched media
5. Optional CLI `--destination` for allowlisted CI. Not default `check`. Not grpc.
