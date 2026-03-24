# Hercules Gym-Speak Parsing Examples

## Purpose

These examples define what the gym-speak SLM should do in v1.
They are not prompt copy.
They are expected behavior fixtures for parser design, testing, and evaluation.

## Output contract for examples

Each example assumes the parser returns:

- structured set fields
- a concise human-readable note
- timer intent if present
- a review flag when confidence is not high enough

## High-confidence examples

### 1. Standard working set with fatigue note

Input:

`bench 225 for 5, rep four and five slowed down, rest 2`

Expected:

```json
{
  "movement": "Bench Press",
  "load": { "value": 225, "unit": "lb" },
  "reps": 5,
  "effort": { "band": "high" },
  "barSpeed": "slow",
  "feelingNote": "Reps four and five slowed down.",
  "restPrescriptionSeconds": 120,
  "needsReview": false
}
```

Note:

`Bench set at 225 x 5. Last two reps slowed down.`

### 2. Easy top set

Input:

`deadlift top set 405 for 3, moved easy`

Expected:

```json
{
  "movement": "Deadlift",
  "load": { "value": 405, "unit": "lb" },
  "reps": 3,
  "setKind": "top",
  "effort": { "band": "low" },
  "barSpeed": "fast",
  "technicalQuality": "clean",
  "needsReview": false
}
```

Note:

`Top deadlift triple moved clean and easier than expected.`

### 3. Side-specific caution

Input:

`overhead press 115 for 6, right shoulder pinchy on the way down`

Expected:

```json
{
  "movement": "Overhead Press",
  "load": { "value": 115, "unit": "lb" },
  "reps": 6,
  "cautionFlags": [
    {
      "bodyPart": "shoulder",
      "side": "right",
      "severity": "medium",
      "description": "Pinchy on the eccentric."
    }
  ],
  "feelingNote": "Right shoulder felt pinchy on the way down.",
  "needsReview": false
}
```

Note:

`Logged right-shoulder discomfort during the lowering phase.`

### 4. Rest-only command attached to previous movement context

Input:

`same weight, same reps, give me 90`

Expected:

```json
{
  "usesPriorContext": true,
  "restPrescriptionSeconds": 90,
  "needsReview": false
}
```

Note:

`Repeat previous set with a 90-second rest timer.`

Assumption:

This is only valid if there is a clear previous set in the same active session.

## Medium-confidence examples

### 5. Ambiguous load slang

Input:

`squat two plates for 8, kinda smoked`

Expected:

```json
{
  "movement": "Back Squat",
  "reps": 8,
  "effort": { "band": "high" },
  "feelingNote": "Set felt taxing.",
  "transcriptRawPhrasePreserved": "two plates",
  "needsReview": true
}
```

Reason:

`two plates` depends on bar assumptions, units, and whether the athlete means total load or plates per side.

### 6. Ambiguous movement alias

Input:

`did six on press, elbow better, rest 75`

Expected:

```json
{
  "movement": "Press",
  "reps": 6,
  "feelingNote": "Elbow felt better.",
  "restPrescriptionSeconds": 75,
  "needsReview": true
}
```

Reason:

`press` may mean overhead press, machine press, or bench press depending on athlete memory.

## Clarification-worthy examples

The parser should ask for clarification only when the uncertainty would make the log misleading.

### 7. Missing movement

Input:

`185 for 5, better than last week`

Expected behavior:

- ask which movement this applies to, unless previous-set context makes it obvious
- do not invent a movement

### 8. Contradictory effort language

Input:

`that moved easy but it was basically max effort`

Expected behavior:

- preserve both signals
- set `needsReview = true`
- ask a short follow-up only if the effort value is required for downstream logic

## Timer command examples

### 9. Explicit minute command

Input:

`set a three minute timer`

Expected:

```json
{
  "timerOnly": true,
  "timer": {
    "kind": "custom",
    "durationSeconds": 180,
    "label": "Rest Timer"
  }
}
```

### 10. Implicit rest from gym wording

Input:

`one more backoff in 90`

Expected:

```json
{
  "setKind": "backoff",
  "restPrescriptionSeconds": 90,
  "needsReview": false
}
```

## Style rules for generated notes

- preserve the athlete's meaning
- do not add hype language
- do not diagnose injuries
- keep notes to one or two sentences
- if pain is mentioned, keep that detail explicit
- avoid pretending certainty that the parser does not have

## Suggested eval dimensions

Score parser behavior on:

- movement extraction accuracy
- load extraction accuracy
- rep extraction accuracy
- timer extraction accuracy
- effort interpretation quality
- caution flag recall
- over-clarification rate
- under-clarification rate
- note faithfulness

## Minimum useful eval set for early iteration

Create at least 40 examples split across:

- barbell compounds
- dumbbell movements
- machine movements
- bodyweight movements
- pain/discomfort phrases
- slang and shorthand
- timer-only commands
- previous-context references

The first failure mode to watch is not syntax.
It is false confidence.
If Hercules confidently logs the wrong lift or load, trust breaks fast.
