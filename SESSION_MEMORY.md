# Session Memory

This file is a lightweight handoff for future work on Renaissance.

## Current Product Shape

Tabs:

- `Capture`
- `Focus`
- `Thoughts`
- `Commitments`

Intent:

- `Capture` stays input-first and emotionally calm
- `Focus` is the reduction layer
- `Thoughts` is the brain dump / reflective stream
- `Commitments` is the full honest ledger

## Core Principles

- Do not lose the holistic commitments view.
- Add reduction on top of the ledger rather than replacing it.
- For ADHD, the system should reduce ambiguity and overwhelm.
- The app should preserve agency: AI helps narrow, not decide life for the user.
- Daily nudges and weekly reflection are different products and should stay separate.

## What Changed

### UI

- Reworked tab order to `Capture / Focus / Thoughts / Commitments`
- Moved the old brain-dump list into `Thoughts`
- Added a progression card to `Capture`
- Enlarged the Morning Mirror area and reduced mirror text density
- Improved readability of italic helper/support text in thought detail view

### Focus Screen

- `Focus` now centers on:
  - backend/local nudge
  - `Primary Focus`
  - `Why This Matters`
  - `Values Mirror`
  - `Still alive, but not first`
- Removed/demoted form-heavy `Compass` and `Daily Progression` cards from `Focus`
- Nudge text is now expandable when long

### Values / Meaning Layer

- Added shared values logic in `lib/values.ts`
- `Focus` now derives recurring values from recent entries and compares them against open commitments
- Added `Values Mirror`
- Spirit Animal now has a short interpretive reading

### Backend Integration

- Added `public.focus_recommendations` support
- Renaissance reads daily nudge rows from Supabase
- `Capture` shows a compact nudge preview
- `Focus` shows the narrative, reason, and starter step
- App falls back to local heuristics if no backend row exists

## OpenClaw Contract

OpenClaw is optional enhancement, not a dependency.

Renaissance works without OpenClaw using:

- local focus ranking
- local starter-step generation
- local values mirror

OpenClaw improves the app by writing daily nudges into `public.focus_recommendations`.

Required fields:

- `focus_date`
- `phase`
- `recommended_focus_thought_id` optional but preferred
- `recommended_focus_reason`
- `starter_step`
- `narrative`

Important semantics:

- `focus_date` = the day the nudge should appear
- `phase` = the phase of that same day

Examples:

- tonight's nudge shown tonight:
  - `focus_date = current_date`
  - `phase = evening`
- tomorrow morning's nudge shown tomorrow:
  - `focus_date = tomorrow`
  - `phase = morning`

Do not write tomorrow-morning guidance as `phase = evening`.

## Daily Vs Weekly

Daily nudge:

- answers `what do I do next today?`
- short
- action-shaping
- one focus, one reason, one starter step

Weekly reflection:

- answers `what story am I living lately?`
- broader values/action analysis
- should stay in OpenClaw memory or a later weekly artifact

Do not dump weekly-style essays into the app's daily nudge payload.

## Current Files Of Interest

- `App.tsx`
- `lib/values.ts`
- `lib/openai.ts`
- `lib/supabase.ts`
- `scripts/focus-recommendations.sql`
- `OPENCLAW_RENAISSANCE_INTEGRATION.md`

## Build / Test State

- Android APK builds were run through EAS
- Latest relevant build during this session:
  - `https://expo.dev/accounts/kuli_s/projects/renaissance/builds/6c0f9568-6386-43f7-8c61-a7f9c3692286`

## Most Useful Next Steps

1. Install the latest APK and test real phone behavior with current DB rows.
2. Verify phase-aware nudge selection:
   - evening row for today shows as `evening nudge`
3. Tune wording based on actual on-device feel.
4. Only after that, consider local notification scheduling.

## Known Good Feedback From User

- `Still alive, but not first` landed very well
- `Values Mirror` landed well
- spirit-animal interpretation felt good
- GUI changes to `Capture` worked well

## Known Friction

- old `Compass` / `Daily Progression` UI felt too heavy
- backend nudge copy can drift into weekly reflection if not compressed
- nudge date/phase semantics were initially confusing and needed clarifying
