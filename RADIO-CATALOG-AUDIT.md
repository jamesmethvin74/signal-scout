# FREQBEACON global radio catalog audit

Date: 2026-09-14
Production baseline: `e728fd52d20f0683f685291f919d3bd682c56d6d`

## Executive finding

The data volume is not the limiting factor. FREQBEACON can realistically carry a worldwide AM/MW + shortwave identification catalog without stressing the app or Cloudflare. The limiting factors are source fragmentation, licensing/reuse terms, normalization, duplicate transmitters/stations, exact transmitter geography, AM day/night facilities, operating status, and programming/category enrichment.

The strongest path is a two-layer catalog:

1. **Identity/engineering core** — frequency, station/callsign, transmitter site, coordinates, country, power, schedule/status, source provenance.
2. **Semantic enrichment** — sports/news/religious/music/etc., network/brand, language/program notes, verification date.

Receiver-context ranking should remain independent of source. The active SDR's coordinates are the listener location for remote-identification purposes.

## Current FREQBEACON coverage

### Shortwave

FREQBEACON already has a strong global schedule pipeline.

- `full-data.js` fetches the A26 merged schedule and builds runtime shortwave rows from HFCC + EiBi.
- `scripts/generate-a26-identification-catalog.mjs` pins the A26 merged source and creates six static identification shards from 2.3–30 MHz.
- The generator requires at least 500 normalized records before it will publish, groups duplicate schedule rows, keeps time/day/language/target/power metadata, and records source provenance.
- `stations.js` contains 27 curated shortwave seed rows with precise coordinates for important transmitters; these are useful for replacing coarse country-centroid geography.

Main weakness: many generated schedule rows use transmitter-country centroids instead of exact transmitter-site coordinates. The official HFCC A26 data itself exposes transmitter latitude/longitude and should be used directly where available.

### Medium wave / AM

Current AM coverage is the largest gap.

- `freqbeacon-zero-am-catalog.js` contains 67 U.S. AM identification records. It is deliberately a compact curated snapshot rather than a complete national database.
- `stations.js` has only 5 MW seed records, all in central Arkansas.
- This explains misses such as KBRT 740 near the Irvine, California SDR even though the signal is extremely strong.
- The shared identification engine is already capable of receiver-distance and day/night-power ranking; it needs a much larger normalized catalog rather than station-specific patches.

### Important source already being discarded

The same merged A26 file currently used by FREQBEACON contains substantial LW/MW material from sources such as EiBi and Aoki. It includes records across Europe, Asia, Africa, Oceania, and the Americas.

The current FREQBEACON static generator intentionally discards all rows below 2.3 MHz and allows only HFCC/EiBi rows. Therefore global MW/LW data is present upstream but not currently emitted into the app.

This is useful as a gap-discovery/validation source, but it should not be blindly bundled. Each underlying source's redistribution terms must be honored independently. In particular, Aoki-derived rows should stay excluded until reuse terms are verified.

## Source audit and ingestion priority

| Priority | Region / band | Source | What it gives us | Reuse status / caution |
| --- | --- | --- | --- | --- |
| 1 | Global SW | HFCC current-season operational data | frequency, UTC schedule, broadcaster, language, transmitter, exact lat/lon, beam, power, days/dates | official public coordination data; retain attribution/provenance |
| 1 | Global SW + utility hints | EiBi | broad schedule coverage, station names, language, target/site codes, many non-HFCC stations | current EiBi conditions explicitly allow download/use/copy/distribution and third-party software use; attribute source |
| 1 | United States AM | FCC LMS public database files | authorized AM facilities, station identity, frequency, location/engineering records | FCC Open Data labels LMS data Public Domain U.S. Government |
| 1 | Canada AM | ISED Spectrum Management Broadcasting data | downloadable broadcasting authorization data and call signs | official public data; retain source/effective-date provenance |
| 1 | United Kingdom MW | Ofcom MF technical parameters CSV | all currently on-air MF transmitters with technical parameters | official downloadable data; verify attribution/reuse text before bundling |
| 1 | Australia AM | ACMA broadcast transmitter files | callsign, frequency, service area, pattern, power, licence number | official downloadable data; verify exact reuse/attribution terms before bundling |
| 2 | Global HF broadcasting | ITU eHFBC | independent official schedule/reference source | use as authority/cross-check where helpful |
| 2 | Other countries AM/MW | national regulators | local licensed AM station infrastructure | ingest country-by-country where machine-readable/public terms are available |
| Validation only unless permission changes | Worldwide MW/LW | MWLIST | excellent global DX-oriented reference | published terms restrict reproduction/redistribution; do not bulk-import without permission |
| Hold pending terms | MW/LW/SW | Aoki | large international schedule/transmitter catalog | do not ship derived bulk data until redistribution permission is verified |

## Recommended normalized record

```text
id                 stable FREQBEACON identity
band               LW / MW / SW
frequencyKHz       number
callsign            optional but preferred
name                station/service display name
country             transmitter country
region              optional administrative/service region
location            transmitter/site display text
lat / lon           transmitter coordinates
locationAccuracy    exact-site / service-area / centroid / unknown
mode                 AM / DRM / USB / etc.
dayPowerW            AM where available
nightPowerW          AM where available
powerW               single-power services
pattern              directional/ND metadata when useful
start / end           UTC schedule where applicable
days                  operation days
fromDate / toDate     seasonal/effective dates
language              optional
categories            enrichment tags, not regulator inference
source                 source identifier
sourceRecordId         regulator/source stable key
sourceEffectiveAt      source snapshot/effective date
verifiedAt             last FREQBEACON verification
```

## Dedupe / precedence rules

1. Prefer national-regulator engineering data for domestic AM/MW transmitter identity, frequency, coordinates, status and power.
2. Prefer HFCC exact transmitter coordinates/power for HFCC-listed shortwave transmissions.
3. Use EiBi to widen schedule/name/language/target coverage and fill non-HFCC shortwave gaps.
4. Keep multiple same-frequency stations. Never collapse them solely by frequency; receiver geography and time are what choose the likely match.
5. Treat callsign/facility/licence IDs as stronger station keys than display names.
6. Preserve multiple transmitter sites for a single broadcaster when they are physically different facilities.
7. Never infer programming format from frequency or geography. Category metadata is an independent enrichment layer.

## Delivery architecture

The worldwide catalog should remain static/build-generated data, sharded so the browser loads only what it needs.

Suggested shards:

- SW: keep existing frequency shards, but upgrade coordinates from HFCC where available.
- MW/LW: regional shards (`north-america`, `europe`, `asia-pacific`, `latin-america`, `africa-middle-east`) or geospatial buckets if testing shows that to be cleaner.
- A small manifest should expose catalog version, sources, snapshot dates, row counts, and shard checksums.

The browser should never load every worldwide record merely to identify one frequency. IDENTIFY can request the active receiver's regional MW shard plus exact-frequency candidates; Lookup can use the same normalized catalog for category/ranking work.

## First implementation increments

### Increment A — U.S. AM completeness

Build an FCC LMS importer and replace the 67-row curated U.S. snapshot as the primary U.S. AM engineering catalog. Keep curated semantic/category descriptions as overlays. This immediately fixes obvious misses such as strong local stations that are absent from the hand-maintained list.

Acceptance target:
- all active/licensed AM facilities represented with facility/callsign/frequency/geography
- day/night power when available from authoritative engineering records
- deterministic source IDs and dedupe
- current 67 curated rows survive as semantic overlays, not duplicated stations

### Increment B — Canada + UK + Australia

Add ISED, Ofcom MF, and ACMA import adapters into the same normalized schema. Do not write new ranking logic per country.

Acceptance target:
- same IDENTIFY engine works from any selected SDR
- unknown local AM falls sharply in those four first-wave countries
- source/effective dates visible to diagnostics

### Increment C — global SW authority upgrade

Change the A26 generator to ingest exact HFCC transmitter coordinates directly from the official HFCC package instead of using country centroids when an exact HFCC site is available. Continue EiBi enrichment and preserve current static-shard behavior.

### Increment D — remaining world

Work through national regulator datasets by coverage/value and use permissive community schedules as supplemental evidence. Do not sacrifice source provenance or silently ship restricted databases just to claim 100% coverage.

## Category coverage

Getting station identity close to worldwide-complete is much easier than getting worldwide programming categories complete.

For example, FCC/ISED/Ofcom/ACMA engineering data can tell FREQBEACON that a station exists at a frequency and transmitter location, but usually will not reliably say `sports`, `news`, `religious`, etc. Those tags should be maintained in a separate enrichment table keyed to stable station identity with `source`, `confidence`, and `verifiedAt`.

This separation lets IDENTIFY become highly complete first while Browse Sports/News/etc. improves continuously without corrupting engineering truth.

## Bottom line

**Yes: a near-worldwide AM + shortwave identity catalog is technically small enough for FREQBEACON.** We do not need a massive online database or a heavyweight runtime service to make this work. Static normalized shards are sufficient.

The immediate deficit is not storage. It is that FREQBEACON currently has a very complete-looking receiver experience sitting on top of a deliberately tiny AM identity snapshot. The next data work should therefore be bulk-source ingestion, not more one-station additions.
