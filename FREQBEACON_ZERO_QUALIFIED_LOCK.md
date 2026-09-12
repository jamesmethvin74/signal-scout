# FREQBEACON Zero — Qualified Engine Lock

This document defines the known-good, qualified FREQBEACON Zero SDR engine baseline and the regression rules for future work.

## Qualified checkpoint

- Qualified date: 2026-09-12
- Qualified production SHA: `5aced89513be1bbb1e4361f3dba8ec9f27dd6ff9`
- Recovery branch: `checkpoint/freqbeacon-zero-qualified-20260912`
- Earlier visual/runtime freeze checkpoint: `checkpoint/freqbeacon-zero-stable-20260912`
- Earlier frozen SHA: `e50288e5da7b4514363644876ace0d9c06b7e0a6`

The qualified checkpoint is the authoritative restore point for the current Zero engine plus its qualification bench.

## What is qualified

The following behavior was proven on one paired Kiwi session without failover:

- One SND socket + one paired W/F socket remain open through the full run.
- Same session survives retunes from 60 kHz through 29.600 MHz.
- AM works.
- SAM works.
- LSB works.
- USB works.
- CW works.
- NBFM works.
- LW, MW, SW, 80m, 40m, 20m, HF aeronautical USB, CB and 10m NBFM all retune successfully.
- Every tested retune recovered in about 1 second.
- W/F history resets only when appropriate for a true span/band jump; the sockets do not reopen.
- Spectrum/waterfall rendering remains tied to real W/F frames.
- Display-rate spectrum interpolation may smooth motion, but it must not fabricate W/F history rows.

## Waterfall cadence lesson

Do not interpret Kiwi `MSG wf_fps=<n>` as guaranteed delivered frame rate.

Qualification proved that a receiver may ACK FAST / 23 FPS while physically delivering much less. On the N2YO qualification receiver, the speed proof showed approximately:

- request 5 FPS -> ACK 5 -> actual 4.8 FPS
- request 13 FPS -> ACK 13 -> actual 11.5 FPS
- request FAST / 23 FPS -> ACK 23 -> actual 11.5 FPS

Therefore:

- Receiver W/F capacity is separate from Zero engine correctness.
- Grade retune recovery against the receiver's measured sustainable FAST baseline, not blindly against 23 FPS.
- Audio health does not prove waterfall health.
- Receiver selection quality must eventually include W/F capacity/cadence, not audio alone.
- Do not fake extra waterfall rows to hide a slow receiver.

## Qualification result

Auto Qualification V3 passed across the full tested range with the calibrated receiver baseline:

- LW AM: 95% of calibrated W/F baseline — PASS
- MW AM: 99% — PASS
- MW SAM: 100% — PASS
- SW AM: 99% — PASS
- 80m LSB: 97% — PASS
- 40m CW: 99% — PASS
- 20m USB: 97% — PASS
- HF AIR USB: 97% — PASS
- CB 19 AM: 99% — PASS
- 10m NBFM: 100% — PASS

All stages recovered in about 1 second with the socket pair stable.

## Preservation rules

Treat the Zero engine as frozen unless a specific defect requires a change.

Do not casually rewrite or replace:

- Zero SND session setup/auth/tuning flow
- Zero paired W/F session setup
- Kiwi SND/W/F pairing behavior
- W/F binary frame decoding
- real RF spectrum/waterfall rendering path
- display-rate spectrum interpolation behavior
- direct spectrum/needle/pan tuning behavior
- Cloudflare cleanroom WebSocket routing

Future UI work should be layered around the qualified engine wherever possible.

The Gemini-inspired shell, band explorer, mode controls, fine tune controls, tuning knob, meters and lower control deck should call the proven tuning/mode functions rather than reimplementing the SDR engine.

## Regression gate for any core change

If a future PR modifies Zero core SDR/session/tuning/rendering behavior, it is not considered safe until all of the following are true:

1. One SND + one W/F socket pair establishes once and stays stable.
2. No failover or hidden receiver swap occurs during qualification.
3. Auto Qualification V3 is run against a suitable qualification receiver.
4. The receiver's sustainable FAST W/F baseline is measured first.
5. LW through 29.600 MHz all retune on the same pair.
6. AM, SAM, LSB, USB, CW and NBFM all pass.
7. Retune recovery remains fast and no stage materially degrades relative to the measured baseline.
8. UI/main-thread performance remains healthy.
9. Waterfall rows still represent genuine received W/F frames.
10. The diff is focused and does not pull legacy contaminated SDR modules into Zero.

## Restore procedure

If future work breaks Zero:

- Do not reset, rebase or force-push `main`.
- Compare the broken files against `checkpoint/freqbeacon-zero-qualified-20260912`.
- Restore only the affected Zero files from checkpoint SHA `5aced89513be1bbb1e4361f3dba8ec9f27dd6ff9` in a focused recovery PR.
- Re-run the qualification gate before merging the recovery.

This checkpoint exists specifically so the proven engine can always be recovered without guessing which historical combination worked.
