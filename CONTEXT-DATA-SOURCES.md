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

### Mexico — regulator-grade MW candidate, fail-closed
- Authority: Comisión Reguladora de Telecomunicaciones / IFT Registro Público de Concesiones (RPC)
- Official open-data source: `Infraestructura de estaciones de radio AM y FM` workbook, dated 25 August 2026
- Source URL: `https://rpc.ift.org.mx/vrpc/assets/publish/uploads/infraestructura/01_infraestructura_AM_FM_250826.xlsx`
- Source page: `https://rpc.ift.org.mx/vrpc/visor/downloads`
- Required fields for FREQBEACON promotion: station identity/callsign, AM frequency, transmitter latitude/longitude, technical power, plus licence/location metadata when published
- Power handling: only explicit watt/kilowatt units are accepted; unknown units fail closed
- Coordinate handling: only coordinates present in the official technical workbook are accepted. FREQBEACON does not geocode a municipality or service area and pretend it is a transmitter site.
- Build gate: at least 100 valid MW transmitter records and the XEW 900 kHz marker must survive normalization. If the current workbook does not expose real transmitter coordinates, the build is intentionally rejected and Mexico remains on EiBi fallback instead of being promoted.
- Runtime: when the build gate passes, the app receives static normalized records and never calls RPC while listening
- Confidence: Tier 1 only after all technical gates pass; merely appearing in the RPC open-data workbook is not by itself enough for FREQBEACON's station-level geographic ranking
- Attribution/licensing: RPC labels the workbook as open data and the generated metadata/source text retains CRT/IFT/RPC attribution. No Creative Commons licence is asserted by this implementation where the source page does not state one.

### Finland — regulator-grade MW/LW
- Authority: Finnish Transport and Communications Agency Traficom
- Official source: `Radioasematiedot` / Radio stations in Finland, Traficom Open Data API v13 (OData v4)
- API documentation: `https://opendata.traficom.fi/swagger/ui/index`
- Endpoint: `https://opendata.traficom.fi/api/v13/Radioasematiedot`
- Freshness: Traficom describes the radio-station dataset as updated daily
- Fields ingested: record ID, municipality, transmitter/station name, frequency in Hz, ERP in watts, EUREF-FIN DMS latitude/longitude, licence number/owner, start/end date, additional info and directivity
- Band filtering: only 148.5–283.5 kHz LW broadcast and 520–1710 kHz MW records are retained; FM and non-broadcast bands never enter the terrestrial MW/LW asset
- Status handling: expired dated records are rejected and zero/non-positive ERP is rejected
- Current marker: Traficom's current frequency-planning guidance states that Finland has one licensed low-power AM frequency in operation, Tampere 729 kHz; the generator requires a Tampere/Pispala 729 kHz record before it will publish the Finland slice
- Licence/attribution: Traficom Open Data API content and service documentation are licensed CC BY 4.0; generated metadata retains Traficom attribution
- Runtime: OData is fetched only during the build; the radio never calls Traficom while listening
- Confidence: Tier 1 / regulator
- Limitations: Traficom exposes directional attenuation fields, but this milestone records the directivity indicator without yet applying the complete azimuth pattern in reception ranking

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

- New Zealand — Radio Spectrum Management's Register of Radio Frequencies is authoritative, but the machine-oriented extract path is not presently a stable unauthenticated build input. Public search alone is not enough for a reproducible Cloudflare catalog build.
- Ireland — ComReg publishes authoritative spectrum/frequency information, but no current machine-readable MW/LW broadcast transmitter dataset with the full identity + precise coordinates + power contract was verified for this milestone.
- France — ANFR open-data services are authoritative, but no current broadcast AM transmitter feed meeting the complete FREQBEACON technical contract was verified.
- Germany — Bundesnetzagentur is authoritative, but no practical current public bulk broadcast-transmitter export suitable for an unattended build was verified.
- Spain — historical official MW plans contain useful technical detail, but historical plan data is not promoted as a current transmitter inventory.
- Italy — no current official unattended bulk feed satisfying identity + frequency + precise site coordinates + power + status was verified.
- Netherlands / Belgium / Scandinavia outside Finland — useful official frequency/licence/search surfaces exist, but the feeds evaluated did not yet provide a verified stable build path with the complete transmitter technical contract. Denmark's public frequency-register export is a promising future candidate and should be revisited separately rather than scraped ad hoc.
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
- MW/LW station ranking uses transmitter distance and appropriate technical power; Canada can select separate day/night transmitter coordinates.
- Zero/silent technical records are rejected or made ineligible.
- Tier 1 regulator records outrank EiBi/reference fallback records on the same channel.
- Known station-level matches beat generic Medium Wave / AM Broadcast or Longwave cards only when the station-level candidate clears the geographic/technical confidence threshold.
- If no responsible candidate exists, the existing generic band/service fallback remains.
- No regulator website is queried while the radio is running.

## Build safety / refresh

`scripts/generate-global-terrestrial-catalog.mjs` is fail-closed. It validates required source structure, minimum national/fallback record counts, coordinate/frequency/power ranges, and known current marker records before writing either generated asset. The pinned Ofcom snapshot is additionally protected by an exact raw CSV SHA-256 check. Mexico is additionally required to expose genuine coordinate-bearing technical rows; Finland is required to expose its current 729 kHz Tampere marker. The generator also prints generated byte sizes so startup cost can be monitored before introducing country sharding.

The generated outputs are:
- `freqbeacon-zero-global-mw-lw.js` — regulator-grade Canada/UK/Australia plus any new country slice that passes all build gates (currently Finland; Mexico only when its live technical workbook passes the coordinate/count/marker gates)
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
