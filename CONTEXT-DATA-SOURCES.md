# FREQBEACON contextual data sources

Purpose: expand Lookup so every trusted SDR can be treated as the listener's temporary location and category recommendations can be ranked from that receiver's coordinates.

The recommendation engine is global. Dataset coverage is tracked separately and must never be implied to be complete when it is not.

## Source priority

1. National regulator / ANSP / ITU machine-readable data
2. Official station or network data for programming/category enrichment
3. Stable public reference data only when an authoritative source does not expose the needed semantic field

Receiver health is not part of this catalog and must not alter the user's local reception score.

## Broadcast station infrastructure

### United States
- FCC broadcast station data
- Fields needed: callsign, frequency, transmitter coordinates, day/night power, status
- Category enrichment: station/network public information where regulator data does not identify programming format

### Canada
- Innovation, Science and Economic Development Canada Broadcasting Database extract
- Public downloadable broadcast data includes AM/FM station records and technical parameters
- Use for callsign/frequency/location/power; enrich format/category separately

### United Kingdom
- Ofcom Technical Parameters for Broadcast Radio Transmitters
- Public CSV/XLS data for currently on-air MF/VHF/DAB transmitters
- Use MF records for medium-wave receiver-local recommendations

### Australia
- ACMA broadcast transmitter data / Register of Radiocommunications Licences
- Public downloadable transmitter datasets include callsign, frequency, service area and power
- ACMA licence permits incorporation/derivative use subject to its attribution and personal-information restrictions

### Global shortwave
- Existing FREQBEACON A26 HFCC/EiBi schedule pipeline
- ITU eHFBC is an additional authoritative schedule/reference source and publishes current seasonal/monthly HFBC schedule material

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

## Import contract

Context records should normalize to:
- id / callsign
- name
- frequencyKHz
- mode
- lat / lon
- country / region / service area
- dayPowerW / nightPowerW when applicable
- categories
- source
- sourceRegion
- verifiedAt / effective date when available

Aviation network records should additionally carry:
- network/family id
- frequencies
- geographic coverage bounds or service polygon
- source
- effective date

This keeps recommendation logic independent of which country supplied the data.
