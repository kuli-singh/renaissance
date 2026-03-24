# Hercules v1 Data Model

## Goals

The v1 model should optimize for three things:

- extremely fast capture from spoken gym shorthand
- enough structure to support history, summaries, and timer behavior
- low-friction correction when the parser is almost right but not perfect

The model should stay event-oriented.
Do not over-normalize early.
Most value comes from recording what happened in sequence during a session.

## Design assumptions

- single athlete per local app install in v1
- one active session at a time
- voice capture produces both structured fields and a preserved raw transcript
- parser confidence matters because gym speech is compact and ambiguous
- timer events should be stored explicitly rather than inferred later

## Entity overview

### athlete_profile

Represents the athlete's long-lived defaults and interpretation preferences.

```ts
export interface AthleteProfile {
  id: string;
  displayName: string;
  preferredUnits: 'lb' | 'kg';
  effortMode: 'bands' | 'rpe' | 'both';
  defaultRestSeconds: number;
  trainingStyle?: string;
  availableEquipment?: string[];
  movementAliases: MovementAlias[];
  injuryNotes: InjuryConstraint[];
  coachVoice: 'preserve-athlete' | 'concise-coach';
  createdAt: string;
  updatedAt: string;
}

export interface MovementAlias {
  alias: string;
  canonicalMovement: string;
  variation?: string;
}

export interface InjuryConstraint {
  bodyPart: string;
  side?: 'left' | 'right' | 'bilateral';
  summary: string;
  severity?: 'low' | 'medium' | 'high';
}
```

### training_session

Represents one workout session.

```ts
export interface TrainingSession {
  id: string;
  athleteId: string;
  startedAt: string;
  endedAt?: string;
  title?: string;
  goal?: string;
  location?: string;
  status: 'active' | 'completed' | 'abandoned';
  summary?: SessionSummary;
}

export interface SessionSummary {
  standoutWin?: string;
  cautionFlag?: string;
  fatigueTrend?: 'building' | 'steady' | 'spiked';
  totalSets: number;
  totalVolumeLoad?: number;
  totalVolumeUnit?: 'lb' | 'kg';
}
```

### set_event

This is the core object.
Each spoken set should become one `set_event` plus optional `timer_event`.

```ts
export interface SetEvent {
  id: string;
  sessionId: string;
  sequenceIndex: number;
  recordedAt: string;
  source: 'voice' | 'manual' | 'import';
  transcriptRaw?: string;
  transcriptNormalized?: string;
  parserConfidence: number;
  needsReview: boolean;

  movement: string;
  variation?: string;
  load?: LoadValue;
  reps?: number;
  repRange?: {
    min: number;
    max: number;
  };
  setKind?: 'warmup' | 'working' | 'top' | 'backoff' | 'drop';

  effort?: EffortValue;
  barSpeed?: 'fast' | 'steady' | 'slow' | 'grinder';
  technicalQuality?: 'clean' | 'loose' | 'breakdown';

  feelingNote?: string;
  coachingNote?: string;
  cautionFlags: CautionFlag[];
  tags: string[];

  restPrescriptionSeconds?: number;
  linkedTimerEventId?: string;

  createdAt: string;
  updatedAt: string;
}

export interface LoadValue {
  value: number;
  unit: 'lb' | 'kg';
  isPerSide?: boolean;
  isBodyweightAdded?: boolean;
}

export interface EffortValue {
  band?: 'low' | 'medium' | 'high' | 'max';
  rpe?: number;
  confidence?: number;
}

export interface CautionFlag {
  bodyPart: string;
  side?: 'left' | 'right' | 'bilateral';
  severity: 'low' | 'medium' | 'high';
  description: string;
}
```

### timer_event

Stores timer behavior directly so the UI and analytics do not need to infer intent from set logs.

```ts
export interface TimerEvent {
  id: string;
  sessionId: string;
  linkedSetEventId?: string;
  kind: 'rest' | 'interval' | 'custom';
  label: string;
  durationSeconds: number;
  startedAt: string;
  endedAt?: string;
  state: 'running' | 'completed' | 'cancelled';
  source: 'voice' | 'tap' | 'default';
}
```

### parser_trace

Optional but useful during v1 iteration.
This should not block shipping, but it is valuable for improving the gym-speak model.

```ts
export interface ParserTrace {
  id: string;
  sessionId: string;
  setEventId?: string;
  transcriptRaw: string;
  structuredOutputJson: string;
  modelVersion: string;
  latencyMs?: number;
  clarificationAsked: boolean;
  clarificationReason?: string;
  createdAt: string;
}
```

## Recommended storage shape for v1

Start with four tables or collections:

- `athlete_profiles`
- `training_sessions`
- `set_events`
- `timer_events`

Optional v1.1:

- `parser_traces`

This is enough to support:

- active session capture
- chronological history
- timer restoration if the app resumes
- movement-grouped review
- simple fatigue and pain summaries

## Required fields for a successful voice parse

A voice parse should be considered usable if it resolves:

- `movement`
- one of `reps` or `repRange`
- at least one of `load`, `effort`, `feelingNote`, or `restPrescriptionSeconds`

If the parser cannot confidently identify the movement, mark `needsReview = true`.

## Ambiguity rules

### Load ambiguity

- `two plates` should resolve through athlete unit defaults and known bar assumptions
- if that assumption is unsafe, preserve the raw phrase and set `needsReview = true`

### Effort ambiguity

- `moved easy` can map to low effort without asking a question
- `hard but clean` should become medium/high effort plus `technicalQuality = clean`

### Pain / caution ambiguity

- any phrase indicating pain, pinch, tweak, strain, or instability should create a `cautionFlag`
- the system should not rewrite these into motivational language

## Derived views the UI will likely need

These do not need their own persisted tables yet.

### exercise_block_view

Groups consecutive `set_events` by canonical movement plus variation.

### session_feed_view

Interleaves `set_events` and `timer_events` in timestamp order.

### recovery_alert_view

Flags recent sessions where the same body part appears in caution notes repeatedly.

## Sample object

```json
{
  "id": "set_017",
  "sessionId": "session_002",
  "sequenceIndex": 17,
  "recordedAt": "2026-03-20T18:42:10Z",
  "source": "voice",
  "transcriptRaw": "front squat 185 for 5, last rep grinder, left wrist felt weird, give me 2 minutes",
  "transcriptNormalized": "front squat 185 pounds for 5 reps, last rep grinder, left wrist felt weird, rest 120 seconds",
  "parserConfidence": 0.92,
  "needsReview": false,
  "movement": "Front Squat",
  "load": {
    "value": 185,
    "unit": "lb"
  },
  "reps": 5,
  "setKind": "working",
  "effort": {
    "band": "high"
  },
  "barSpeed": "grinder",
  "feelingNote": "Left wrist felt weird on the set.",
  "coachingNote": "Final rep slowed down. Monitor wrist comfort next set.",
  "cautionFlags": [
    {
      "bodyPart": "wrist",
      "side": "left",
      "severity": "medium",
      "description": "Felt weird during front rack position."
    }
  ],
  "tags": ["front-squat", "working-set", "wrist-note"],
  "restPrescriptionSeconds": 120,
  "linkedTimerEventId": "timer_017",
  "createdAt": "2026-03-20T18:42:10Z",
  "updatedAt": "2026-03-20T18:42:10Z"
}
```

## v1 boundaries

Do not include these yet unless they become unavoidable:

- social features
- programming engine / workout plan authoring
- camera analysis
- wearable integrations
- live coach chat threads
- complicated PR taxonomy

The first version only needs to capture lifts accurately, preserve nuance, and keep the athlete moving.
