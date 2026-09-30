# FREQBEACON External Source Compliance Policy

Effective: 2026-09-30

FREQBEACON fails closed on external data and service permissions.

## Required gate

An external source may be used only when the repository records:

1. the first-party source URL or operator-approved endpoint;
2. the acquisition method;
3. the licence, public-domain designation, terms, or explicit permission that authorizes the intended use;
4. any attribution requirement;
5. the permitted refresh/access pattern;
6. the date the permission was reviewed.

Public reachability is not permission to scrape, copy, republish, or bypass controls. If authorization is unclear, the source stays disabled until it is cleared.

For interactive services, FREQBEACON must identify and behave as the type of client it actually is. A server/operator rejection is final; the app must not switch protocols, paths, identities, proxies, or cached directories to defeat that control.

## Current source register

| Source | Status | Permitted use / action |
| --- | --- | --- |
| KiwiSDR public receivers | ALLOWED WITH OPERATOR CONTROLS | FREQBEACON connects only as an external client. Kiwi's external-app channel limit must be enforced by the receiver. If the receiver rejects the session, FREQBEACON does not route around it. |
| ReceiverBook receiver directory | DISABLED | Directory data reuse permission has not been established. No HTML scraping, embedded-array extraction, or stale ReceiverBook cache reuse. Re-enable only after documented permission/licence covers FREQBEACON's directory use. |
| WBCQ / WRMI / broadcaster schedule webpages | DISABLED | Public webpages are not treated as permission for automated schedule extraction and republication. Exact-program enrichment remains off until each source is individually cleared. |
| Draft global program catalog sources (PR #304) | BLOCKED | Do not merge or deploy source adapters until each external source has documented reuse permission and refresh terms. |
| ACMA Licensed Broadcasting Transmitter Data | ALLOWED / INACTIVE | Official downloadable dataset; Creative Commons Attribution 2.5 Australia. Production builds do not fetch it live; activate only from a pinned first-party snapshot with integrity metadata. |
| Ofcom broadcast transmitter technical parameters | ALLOWED | Official open-data publication under the UK Open Government Licence framework. Preserve attribution and snapshot provenance. |
| ISED Broadcasting Database | ALLOWED WITH ATTRIBUTION / INACTIVE | Official Government of Canada downloadable broadcasting data. Treat as Open Government Licence–Canada information and preserve attribution; production builds do not fetch it live. Activate only from a pinned first-party snapshot after checking source-specific exceptions. |
| FCC broadcast engineering data | FIRST-PARTY ONLY | U.S. federal government data may be sourced from FCC public systems. The prior third-party GitHub mirror is disabled. Do not restore the AM catalog until a direct FCC acquisition path is implemented and documented. |
| HFCC schedules | DISABLED PENDING LICENCE CLEARANCE | HFCC labels the area Public Schedule Data but the site also carries an All Rights Reserved notice. Do not redistribute/ingest the schedule until an explicit reuse basis is documented. |
| EiBi schedules | DISABLED PENDING CURRENT TERMS REVIEW | Current site points to Conditions of use, but the current licence text has not yet been archived/verified for FREQBEACON's intended reuse. Historical permission is not enough to assume current permission. |
| Third-party merged HFCC/EiBi files | DISABLED | No third-party mirror or merged dataset is an acceptable substitute for a cleared first-party source. |
| Google/other convenience mirrors | NOT A SOURCE OF AUTHORITY | Do not use a mirror merely because it is easier to fetch. Use the authoritative source and its terms. |

## Engineering requirements

- Every new external adapter must add or update this register in the same pull request.
- A source marked DISABLED/BLOCKED must have a regression test preventing accidental runtime/build access.
- Attribution required by a source must be preserved in generated metadata and any user-visible attribution surface where required.
- Cached data does not outlive permission. If a source is disabled for compliance, its cached/derived runtime dataset must also be disabled.
- Never use a browser/native-client route to impersonate a first-party client when FREQBEACON is an external application.
- Never use credentials, tokens, alternate hosts, mirrors, or proxies to evade a source's access restriction.
- Re-review source terms before materially increasing request volume, adding commercial use, or changing from factual lookup to redistribution.

This file is an engineering compliance gate, not a substitute for legal advice when a source's terms are ambiguous.
