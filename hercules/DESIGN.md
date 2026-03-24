# Hercules Design Notes

## Product thesis

Hercules is a strength training companion for people who think in gym shorthand, not spreadsheet rows.
The app should let a lifter say something like:

`front squat 185 for 5, last rep grinder, left wrist felt weird, give me 2 minutes`

and turn that into structured set data, a useful note, and an active rest timer without forcing manual entry in the moment.

## Why it should feel like Renaissance

Renaissance already has a strong interaction idea:

- one obvious primary button
- fast capture with low cognitive overhead
- a sense that the app is listening for intent, not asking for form fields first

For Hercules, that same interaction model is still right, but the emotional tone changes:

- Renaissance feels reflective and cerebral
- Hercules should feel focused, physical, and immediate

## Design direction

### Personality

- disciplined, not macho parody
- athletic, not bodybuilder-cliche chrome
- concise, not chatty
- confident enough to stay simple during a workout

### Visual system

- dark training-floor palette with green-cyan energy instead of Renaissance neon cyan-on-black duplication
- rounded heavy surfaces that feel like rubber plates and timer hardware
- oversized action button remains the centerpiece
- metrics should read from arm's length

### UX rules

- voice capture is primary
- manual correction is secondary but always available
- the app should never make the user hunt for the timer
- every spoken log should produce both structured data and a natural-language training note
- important state must be readable mid-set in under one second

## Core objects

### Set log

- movement
- variation
- load
- reps
- perceived effort / RPE-style band
- side-specific notes or pain signals
- confidence / bar speed / technical quality note
- rest target
- timestamp

### Session

- goal for the day
- exercise blocks
- total volume summary
- fatigue trend
- standout win
- caution flag

### Athlete profile

- preferred units
- training style
- available equipment
- injury constraints
- timer defaults
- language style for coach feedback

## SLM role

The trained gym-speak SLM should be narrow and practical.
It does not need to be a general coach first.
Its first job is translation:

- convert spoken lifting shorthand into clean structure
- preserve the athlete's exact meaning
- detect uncertainty and ask for clarification only when needed
- map phrases like `grinder`, `moved easy`, `tweaked my back`, `left quad cooked` into compact tags plus human-readable notes

### Example interpretation targets

- `225 for 3, moved easy` -> heavy triple, low perceived effort
- `top set smoked me` -> high fatigue flag
- `right shoulder pinchy on descent` -> caution annotation, side-specific issue
- `rest 90` -> 90-second timer command

## Proposed v1 flow

1. User presses and holds the main button.
2. User explains the set in natural gym speech.
3. Hercules returns:
   - parsed set card
   - short training note
   - started rest timer
4. User either accepts, quick-edits, or records the next set.

## Screen architecture

### Home / Session capture

- hero header with current training objective
- large `Explain Set` button
- current set summary card
- active timer card
- quick correction fields

### Session review

- chronological set feed
- grouped by movement
- highlights for PRs, fatigue spikes, and recurring pain/form notes

### Athlete memory

- personal defaults
- recurring cues
- movement aliases
- known injury considerations

## Open questions

- Should the timer start automatically on every captured set, or only when the spoken command includes rest?
- Do we want classic RPE numbers, plain-language effort bands, or both?
- Should the SLM rewrite the note into coach voice, or preserve raw athlete phrasing by default?
- Is Hercules single-user local-first first, or shared cloud history from day one?
- Does the app need video or form-check hooks in v1, or is that scope creep?

## Near-term build plan

- keep the concept isolated in `hercules/`
- evolve the home screen until the capture loop feels right
- define the set/event data model before wiring backend storage
- create prompt / eval examples for gym-speak parsing
- decide whether timer control is fully voice-driven or mixed voice + tap

## Working specs

The concept docs now have two implementation-oriented companions:

- `DATA_MODEL.md` for the v1 entity shapes and storage boundaries
- `EVALS.md` for example gym-speak inputs and parser expectations

These should be treated as the current source of truth for how Hercules stores a session and what the SLM must reliably understand.
