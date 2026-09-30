# FREQBEACON contextual data sources

Purpose: expand Lookup so every trusted SDR can be treated as the listener's temporary location and category recommendations can be ranked from that receiver's coordinates.

The recommendation engine is global. Dataset coverage is tracked separately and must never be implied to be complete when it is not.

## Source priority

1. National regulator / ANSP / ITU machine-readable data
2. Official station or network data for programming/category enrichment
3. Stable public reference data only when an authoritative source does not expose the needed semantic field

Receiver health is not part of this catalog and must not alter the user's local reception score.

## Broadcast station infrastructure

### United States — FCC MW migration
- Authority target: Federal Communications Commission (FCC), first-party only
- Status: the prior third-party mirror-derived generated asset is compliance-disabled as of 2026-09-30
- Runtime: the disabled asset exports an empty catalog; built-in legacy factual seeds may still provide limited fallback identity
- Re-enable condition: implement and document a direct FCC public-data acquisition path before restoring generated nationwide coverage
- Do not substitute another mirror merely because it is easier to fetch

### Canada — regulator-grade MW
- Authority: Innovation, Science and Economic Development Canada (ISED)
- Source: Broadcasting Database export, dBASEIII archive; AM records come from `AMSTATIO.DBF`
- Source documentation: Broadcasting Database Export User Manual v1.3 (November 2020)
- Fields ingested: province, city, call sign, frequency kHz, class, day/night status, separate day/night transmitter coordinates when present, day/night/critical power, banner/source identity
- Coordinate handling: ISED DDMMSS is converted at build time; source west-positive longitude is converted to ordinary negative WGS84 longitude
- Runtime: generated static catalog; browser never parses DBF and never calls ISED while listening
- Confidence: Tier 1 / regulator
- Refresh: run `node scripts/generate-global-terrestrial-catalog.mjs`; importer validates schema, coordinate/frequency/power ranges, minimum count, and current marker records before writing output
- Limitations: categories remain generic broadcast/MW unless an independent curated overlay supplies programming metadata

### United Kingdom — regulator-grade MW
- Authority: Ofcom
- Official source: `Technical parameters for broadcast radio transmitters` — MF CSV
- Official source URL retained in generated metadata: `https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471`
- Source version used by this milestone: page/data update 5 August 2026
- Pinned build snapshot: `data/ofcom/txparamsmf-2026-08-05.csv.gz`
- Raw CSV SHA-256: `0348c032d137fbc11be6392c93f4e65fa891ecc07d82d847aa1d7605a88bd7e9`
- Why pinned: Cloudflare's build environment cannot reliably retrieve Ofcom's current MF CSV directly. Normal FREQBEACON builds therefore do not depend on Ofcom network availability and do not use a third-party proxy or mirror.
- Snapshot integrity: the generator gunzips the repository snapshot, verifies the exact raw CSV SHA-256 above, then runs the same schema, record-count, coordinate/power, and marker validation before generating app assets.
- Fields ingested: station, area, site, frequency kHz, OS National Grid Reference, in-use EMRP, effective/change date when present
- Coordinate handling: OS National Grid Reference is converted to WGS84 latitude/longitude during the build; no grid conversion occurs in the browser
- Power handling: the current MF feed uses `In-use EMRP (kW)` and legacy variants. Numeric cells with optional recognized `kW`/`W` suffixes are normalized explicitly; unrecognized units/text fail closed instead of being guessed.
- Runtime: generated static catalog; no Ofcom request while listening
- Confidence: Tier 1 / regulator; the snapshot is a vetted copy of the official Ofcom MF data, not a third-party station list
- Refresh procedure: download the new official Ofcom MF CSV; verify expected headers, more than 50 normalized MF records, valid coordinate/power ranges, and the Radio Caroline 648 kHz marker; gzip that validated CSV into `data/ofcom/`; update the dated snapshot path/source date/raw SHA-256 in the generator; rebuild. Never replace the snapshot merely because a network fetch succeeded.
- Limitations: radiation-pattern detail remains regulator provenance but is not yet modeled in the reception rank

### Australia — regulator-grade MW
- Authority: Australian Communications and Media Authority (ACMA)
- Source: Licensed Broadcasting Transmitter Data, `Broadcast Transmitter Excel` ZIP
- Source snapshot used by this milestone: 13 July 2026
- Licence/attribution: Creative Commons Attribution 2.5 Australia; FREQBEACON must attribute ACMA material
- Fields ingested: callsign, frequency, purpose/service type, service area, transmitter/site, latitude/longitude, maximum ERP in watts, licence number
- Runtime: ZIP/XLSX parsing happens only in the build generator; the app receives compact normalized static data
- Confidence: Tier 1 / regulator. ACMA notes that a licence record does not itself guarantee a transmitter is operating, so runtime language must not overstate on-air certainty
- Refresh: update the dated official workbook URL when ACMA publishes a new snapshot, rerun the generator, and verify minimum-count/current-marker validation
- Limitations: categories remain generic broadcast/MW unless separately curated; licensed pattern information is not yet applied to directional ranking

### Global MW/LW fallback
- Status: compliance-disabled as of 2026-09-30
- The former fallback depended on a third-party merged EiBi/HFCC source
- The generated fallback contract is intentionally empty until current first-party reuse permission is documented
- Regulator-grade Canada/UK/Australia coverage remains independent of this fallback

### Global shortwave
- Automated A26 HFCC/EiBi expansion is compliance-disabled as of 2026-09-30
- The browser no longer fetches the third-party merged schedule, and postinstall no longer runs the mirror-based A26 generator
- Built-in factual seed coverage remains available while a cleared first-party schedule source is evaluated
- HFCC's "Public Schedule Data" label alone is not treated as a redistribution licence; explicit reuse authority must be documented before re-enabling automated ingestion

## Generated terrestrial contract

Normalized terrestrial station records may carry:
- `id`, `sourceId`, `sourceAuthority`, `sourceTier`, `sourceCountry`, `sourceDate`
- `type=station`, `band=MW|LW`, `frequencyKHz`, `callsign`, `name`, `location`, `country`, `region`, `serviceArea`
- `lat`, `lon`, plus `dayLat/dayLon` and `nightLat/nightLon` when a regulator exposes separate transmitter sites
- `powerW`, `dayPowerW`, `nightPowerW`, `criticalPowerW`
- `class`, `status`, `mode`
- `categories`, `description`, `source`
- `locationApproximate`, `technicalConfidence`

Sources are allowed to omit fields they do not publish. Identity/deduplication uses regulator/source identity plus frequency/country/site context rather than frequency+callsign alone.

## Runtime / ranking rules

- The selected SDR's real coordinates remain the listener location for IDENTIFY.
- Receiver health and remote-SDR success/failure never alter the user's local reception score.
- MW/LW station ranking uses transmitter distance and appropriate technical power; Canada can select separate day/night transmitter coordinates.
- Zero/silent technical records are rejected or made ineligible.
- Tier 1 regulator records outrank any future cleared reference fallback records on the same channel.
- Known station-level matches beat generic Medium Wave / AM Broadcast or Longwave cards only when the station-level candidate clears the geographic/technical confidence threshold.
- If no responsible candidate exists, the existing generic band/service fallback remains.
- No regulator website is queried while the radio is running.

## Build safety / refresh

`scripts/generate-global-terrestrial-catalog.mjs` is fail-closed. It currently generates only the cleared regulator-grade Canada/UK/Australia catalog and an explicit empty fallback contract. The pinned Ofcom snapshot is protected by an exact raw CSV SHA-256 check.

The generated outputs are:
- `freqbeacon-zero-global-mw-lw.js` — regulator-grade Canada/UK/Australia records
- `freqbeacon-zero-global-mw-lw-fallback.js` — intentionally empty compliance-disabled fallback

`postinstall` runs only the cleared regulator generator, wires those assets into Zero/Lookup, and runs tests. The old A26 and FCC mirror generators are retired and fail closed if invoked directly.

## Aviation HF

### North Atlantic / Canada
- NAV CANADA AIP ENR 7.5 publishes NAT HF families monitored by Gander IFSS

### United States / Caribbean / Pacific
- FAA AIP and aeronautical publications for HF family/frequency data

### Australia / surrounding oceanic sectors
- Airservices Australia AIP/ERSA publishes HF organization and regional/oceanic network structure
- Prefer official freely available publications; do not depend on paid redistribution products when a public publication supports the needed facts

### Additional regions to acquire
- New Zealand / South Pacific ANSP publications
- South America national AIPs / FIR HF publications
- Africa national/regional AIPs / FIR HF publications
- Europe/Mediterranean oceanic and remote HF services where applicable
- Asia FIR/oceanic HF families (Japan, India, Southeast Asia, etc.)

## Sports/category metadata

Regulator datasets normally identify the transmitter, not whether a station is sports/news/music/etc. Keep this as a separate enrichment layer keyed to station identity.

For each category-enrichment record store:
- station identity / callsign
- category tags
- effective/verified date
- source
- confidence

Never infer a sports station merely from geography or frequency. If receiver-local category metadata is missing, Lookup should say coverage is incomplete and fall back only to genuinely global scheduled services.


## Compliance gate

See `SOURCE-COMPLIANCE.md`. Public reachability is not treated as permission for automated extraction or republication, and external receiver controls must never be bypassed.
