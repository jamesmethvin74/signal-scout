# Signal Scout

**What can I hear here, right now?**

Signal Scout is a location-aware radio listening guide for shortwave, medium wave, and eventually longwave/utility listening. Instead of presenting a giant schedule table, it ranks signals by how plausible they are to receive from the listener's current location and explains why.

## MVP

- Browser geolocation
- Current UTC time
- Shortwave and medium-wave browsing
- Now / +1 hr / +3 hr / later tonight views
- Search and language filters
- Reception-likelihood scoring
- Station, frequency, transmitter, distance, schedule, language, format, and power details

The initial frontend is deliberately static and lightweight so it can be deployed cheaply on Cloudflare Workers. Full automated HFCC/EiBi/FCC ingestion is the next data milestone.

Deployment connection verification: 2026-08-23 19:49 CDT.
