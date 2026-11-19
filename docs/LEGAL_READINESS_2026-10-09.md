# FreqBeacon legal readiness — 2026-10-09

**DRAFT. NOT EFFECTIVE. Do not merge/deploy until release gates are resolved.**

## Implemented
- Draft static pages: /legal.html, /privacy.html, /terms.html, /disclaimer.html, each with prominent draft status, plus navigation and an existing /data-sources.html cross-link.
- Legal entry points from Radio/Explore/Lookup/Near Me and the legacy landing page.
- No modification to SDR endpoints, KiwiSDR receiver controls, allowed directories, API behavior, sources, or production configuration.
- Existing SOURCE-COMPLIANCE.md and data-sources.html remain authoritative for permission decisions.

## Source observations
- near-me.js saves location coordinates/label/accuracy/updatedAt/timeZone to localStorage.
- security-hardening.js reads an fb_explore_receiver cookie preference.
- wrangler.jsonc uses Cloudflare Workers, asset binding and D1 receiver health.
- SOURCE-COMPLIANCE.md records permission to fetch KiwiSDR's public directory no more than once per hour with receiver external-client controls; Reader must distinguish receiver operator and app.
- Remote SDR use can transmit browser and tuning metadata to independent receiver operators; this must be traced in deployed-state privacy verification.

## Blocking gate
- [ ] Verified legal operator identity and monitored contact channel; rights request workflow.
- [ ] Deployed telemetry/logging cookies/analytics, request paths, D1, Cloudflare retention and any precise-coordinate server handling confirmed.
- [ ] Evaluate children's privacy, state laws and any consent/cookie-banner requirement based on *actual* practices.
- [ ] Verify radio audio copyright/redistribution and applicable radio-communications jurisdiction limitations with counsel.
- [ ] Reconcile published legal page claims with real deployed KiWiSDR client behavior and SOURCE-COMPLIANCE.md.
- [ ] Audit all program/broadcast reference sources and status; retain blocked-source policy, do not treat these legal notices as permission.
- [ ] Counsel review of terms, liability, jurisdiction, dispute mechanism and effective date.
- [ ] Remove DRAFT labels and noindex only upon final release approval; test each public link and mobile layout in preview and prod.
- [ ] Explicit human approval required to merge/deploy.

References:
- https://www.ftc.gov/business-guidance/resources/marketing-your-mobile-app-get-it-right-start
- https://github.com/jamesmethvin74/signal-scout/blob/main/SOURCE-COMPLIANCE.md
