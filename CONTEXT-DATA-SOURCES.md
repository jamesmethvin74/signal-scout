# FREQBEACON contextual data sources

Purpose: expand Lookup so every trusted SDR can be treated as the listener's temporary location and category recommendations can be ranked from that receiver's coordinates.

The recommendation engine is global. Dataset coverage is tracked separately and must never be implied to be complete when it is not.

## Source priority

1. National regulator / ANSP / ITU machine-readable data
2. Official station or network data for programming/category enrichment
3. Stable public reference data only when an authoritative source does not expose the needed semantic field

Receiver health is not part of this catalog and must not alter the user's local reception score.

## Broadcast station infrastructure

### United States — regulator-grade MW
- Authority: Federal Communications Commission (FCC)
- Build input: pinned FCC-derived AM engineering snapshot used by `scripts/generate-fcc-am-catalog.mjs`
- Fields ingested: callsign, frequency, transmitter coordinates, day/night/critical power, status
- Runtime: generated static catalog; no FCC request while listening
- Confidence: Tier 1 technical record plus separate FREQBEACON programming/category overlays
- Refresh: update the pinned source snapshot/validation marker and rebuild
- Limitations: category/program format is not inferred from FCC geography or frequency

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

### Brazil — regulator-grade MW
- Authority: Brazilian Ministry of Communications (MCom), using the federal SCR/Mosaico broadcasting registry associated with Anatel licensing data
- Official build input: `https://s3.mcom.gov.br/radcom/SCR_DADOS_RADIODIFUSAO_TV_GTVD_RTV_RTVD_FM_OM.csv`
- Dataset: `Conjunto de Dados de Radiodifusão (SCR)`, which explicitly includes `OM` (Onda Média / medium wave) alongside the other broadcast services
- Publication/freshness: MCom's open-data catalog lists the SCR broadcasting/licensing datasets as recurring federal open data; the 2025–2027 open-data plan provides monthly publication for the licensing data
- File handling: the federal export is ISO-8859-1 and semicolon-delimited. It is decoded and parsed only at build time.
- Current station contract: MCom's station dictionary defines `indstatusestacao=M` as `Estação Instalada e Licenciada`, `freqop` as the operating frequency, `medlatitude`/`medlongitude` as station coordinates, `nomeindicativoestacao` as station identity, `respnomeentidade` as the responsible entity, `SiglaSituacao` as station situation, and `medpotenciairradiadaerpmax` as maximum ERP.
- Service/status filtering: only `OM` records are eligible. When the current station-status field is present, FREQBEACON requires `indstatusestacao=M`; older flattened SCR exports are accepted only through their licensed status field when the current status field is absent. Explicit inactive/cancelled/closed station states are rejected.
- Fields ingested when present: station/plan identity, callsign, licensee/entity, transmitter municipality/UF, operating frequency, precise transmitter latitude/longitude, maximum ERP, optional directly-published day/night power fields, station situation, and extraction date
- Frequency handling: the importer accepts the official export's known MHz/kHz/Hz representations, normalizes to kHz, and rejects anything outside 520–1710 kHz
- Power handling: the regulator's ERP values are treated as kW and normalized to watts. If an export explicitly exposes separate day/night technical power, those fields are retained; an explicit zero remains zero and is never replaced by ERP. Records with no positive technical power are rejected.
- Coordinate handling: only transmitter/station-coordinate fields are accepted; municipality/city centroids are never substituted for a missing site. Coordinates must also fall within a conservative Brazil geographic envelope, which catches swapped or malformed coordinates.
- Current marker: the build requires a licensed 980 kHz Brasília record (`Brasília`, `Nacional`, `EBC`, or `Empresa Brasil`) before the Brazil slice can be published. EBC continues to list Rádio Nacional AM de Brasília on 980 kHz in September 2026.
- Runtime: the federal CSV is fetched only during the build; the radio never calls MCom/Anatel while listening
- Confidence: Tier 1 / regulator
- Reuse: source is published through the Brazilian federal open-data program; generated metadata retains the federal source URL and open-data provenance
- Limitations: SCR exposes OM antenna/day-night directional engineering fields beyond what this milestone applies. Those pattern values are not yet converted into a complete azimuth radiation model.

### Global MW/LW fallback — reference only
- Authority/source: EiBi rows from the existing pinned A26 merged HFCC/EiBi schedule source
- Output: separate generated low-frequency fallback asset; these rows are not mixed into the existing A26 shortwave shards
- Scope: normal LW broadcast allocation 148.5–283.5 kHz and MW broadcast allocation 520–1710 kHz
- Filtering: EiBi only, requires station and schedule fields, excludes negative/utility language rows and utility/NDB/navigation/service-name patterns
- Coordinates: country centroid only when no precise site coordinate exists; such rows are explicitly marked `locationApproximate=true`
- Confidence: reference/fallback, never regulator-grade
- Precedence: regulator records outrank fallback rows on the same frequency; curated FREQBEACON metadata may enrich a regulator record but must not replace technical coordinates/power
- Refresh: regenerated from the same pinned A26 source as the shortwave pipeline

### Global shortwave
- Existing FREQBEACON A26 HFCC/EiBi schedule pipeline remains unchanged and sharded from 2.3–30 MHz
- ITU eHFBC is an additional authoritative schedule/reference source and may be used for verification, but FREQBEACON does not require an authenticated or paid ITU service for ordinary builds

## Sources evaluated but not promoted to regulator-grade terrestrial coverage

These are intentionally left on EiBi/reference fallback until an official source satisfies the technical and build-reliability contract. This list is not a statement that the national regulator lacks data; it records why FREQBEACON is not importing it yet.

- Finland — Traficom's `Radioasematiedot` API is authoritative and useful, but the live low-frequency inventory did not validate cleanly enough against the currently published 729 kHz Tampere/Pispala AM guidance to make a fail-closed production build dependable. Finland therefore stays on reference fallback until the precise live source/record contract is reconciled rather than forcing a stale marker or guessed record.
- Mexico — CRT/IFT RPC publishes an authoritative current AM/FM infrastructure workbook and datos.gob.mx exposes monthly AM/FM open data under CC BY 4.0, but the published bulk field contract is concession/service-area oriented (folio, population/state, concession/use, callsign, band and frequency) rather than a transmitter-site engineering feed. The surfaced bulk data does not supply the precise transmitter coordinates required for FREQBEACON's distance ranking, so Mexico remains fallback rather than being geocoded from a city or municipality.
- New Zealand — Radio Spectrum Management's Register of Radio Frequencies is authoritative, but the machine-oriented extract path is not presently a stable unauthenticated build input. Public search alone is not enough for a reproducible Cloudflare catalog build.
- Ireland — ComReg publishes authoritative spectrum/frequency information, but no current machine-readable MW/LW broadcast transmitter dataset with the full identity + precise coordinates + power contract was verified for this milestone.
- France — ANFR open-data services are authoritative, but no current broadcast AM transmitter feed meeting the complete FREQBEACON technical contract was verified.
- Germany — Bundesnetzagentur is authoritative, but no practical current public bulk broadcast-transmitter export suitable for an unattended build was verified.
- Spain — historical official MW plans contain useful technical detail, but historical plan data is not promoted as a current transmitter inventory.
- Italy — no current official unattended bulk feed satisfying identity + frequency + precise site coordinates + power + status was verified.
- Netherlands / Belgium / Scandinavia — useful official frequency/licence/search surfaces exist, but the feeds evaluated did not yet provide a verified stable build path with the complete transmitter technical contract. Denmark's public frequency-register export is a promising future candidate and should be revisited separately rather than scraped ad hoc.
- Japan — no current no-auth official bulk AM transmitter technical feed meeting the full contract was verified.
- South Korea — the public radio-channel data surfaced for this milestone identifies broadcaster/region/channel/frequency but does not provide the precise transmitter coordinates and technical power needed for FREQBEACON's regulator-grade geographic ranking.

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
- MW/LW station ranking uses transmitter distance and the best technical power field a regulator actually publishes. Canada can select separate day/night transmitter coordinates; Brazil uses regulator ERP and preserves separate day/night power only when explicitly present in the source.
- Zero/silent technical records are rejected or made ineligible.
- Tier 1 regulator records outrank EiBi/reference fallback records on the same channel.
- Known station-level matches beat generic Medium Wave / AM Broadcast or Longwave cards only when the station-level candidate clears the geographic/technical confidence threshold.
- If no responsible candidate exists, the existing generic band/service fallback remains.
- No regulator website is queried while the radio is running.

## Build safety / refresh

`scripts/generate-global-terrestrial-catalog.mjs` is fail-closed. It validates required source structure, minimum national/fallback record counts, coordinate/frequency/power ranges, and known current marker records before writing either generated asset. The pinned Ofcom snapshot is additionally protected by an exact raw CSV SHA-256 check. Brazil is required to expose a licensed/installed 980 kHz Brasília marker. The generator also prints generated byte sizes so startup cost can be monitored before introducing country sharding.

The generated outputs are:
- `freqbeacon-zero-global-mw-lw.js` — regulator-grade Canada/UK/Australia/Brazil records
- `freqbeacon-zero-global-mw-lw-fallback.js` — separate EiBi/reference MW/LW fallback

`postinstall` generates these assets and wires them into the built Zero and Lookup HTML immediately before the existing identification data/engine consumers. The existing A26 SW shards and SDR/Kiwi protocol files are untouched.

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
