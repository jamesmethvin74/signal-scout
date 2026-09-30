// Compliance gate — A26 shortwave mirror generator retired 2026-09-30.
//
// This generator previously depended on a third-party mirror whose reuse
// authority was not documented to FREQBEACON's standard. Do not restore it
// with another mirror or scraped substitute. Implement a cleared first-party
// source, document it in SOURCE-COMPLIANCE.md, and add regression coverage
// before re-enabling this build step.

throw new Error('A26 shortwave mirror generator is disabled pending a cleared first-party source.');
