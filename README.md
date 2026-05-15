# Renaissance

Renaissance is a mobile personal-intelligence system: voice capture on the front end, agentic reflection on the back end, and daily guidance returned through the app.

It is not a notes app. It is a feedback loop for living.

Renaissance captures the raw material of a life - thoughts, energy, commitments, vents, dreams, values, food memories, and emotional texture - into Supabase. Nanoclaw/OpenClaw reads that shared database, reasons over the patterns, and writes back focused nudges, recommended actions, and spirit-animal guidance. Renaissance then renders those backend-authored insights as a morning mirror, focus feed, commitment surface, values mirror, and daily companion.

The product is powerful because the intelligence does not stop at analysis. It returns as an intervention.

## The Core Loop

```text
Voice capture
  -> transcription
  -> thought extraction
  -> classification
  -> embeddings
  -> Supabase memory
  -> Nanoclaw/OpenClaw reasoning
  -> focus_recommendations
  -> mobile guidance
  -> action and capture
```

The more honestly the user captures, the richer the backend memory becomes. The richer the memory becomes, the more precise the daily nudge. The nudge then changes what the user does next, which creates the next data point.

That is the loop Renaissance is built around.

## Product Experience

- **Capture** - press and hold to record messy thoughts in natural speech.
- **Morning Mirror** - a short reflection from the previous day that turns raw capture into a daily reset.
- **Focus** - morning, midday, and evening nudges written into Supabase by Nanoclaw/OpenClaw.
- **Spirit Animal** - a symbolic interface for pattern recognition, backed by current behavioural data and, when available, backend-authored prescriptions.
- **Commitments** - actionable thoughts become tracked promises with progress, completion, reopening, and abandonment.
- **Values Mirror** - compares what repeatedly appears in thoughts with what is actually represented in commitments.
- **Focus Archive** - preserves previous nudges by date, so the user can see what the system was asking them to notice or act on.

## Why It Matters

Most productivity systems flatten a person into tasks.

Renaissance keeps the person intact. It captures emotion, body state, ambition, avoidance, relationships, creativity, admin friction, and meaning. Then it uses AI to compress that complexity into one useful next move.

The morning mirror is not a summary. It is a daily re-entry point.

The spirit animal is not decoration. It is a compact emotional display for a pattern the system is seeing.

The focus recommendation is not generic motivation. It is a backend-authored nudge grounded in the user's own entries, commitments, values, and recent drift.

## AI Engineering

Renaissance uses AI in two layers.

### 1. In-app AI pipeline

The mobile app calls a server-side AI function for:

- audio transcription
- thought extraction from long messy recordings
- category and energy classification
- strategic insight generation
- commitment suggestion
- embedding generation
- morning mirror generation
- local fallback focus guidance

Each recording can become multiple structured thoughts. Each thought can carry category, energy, insight, embedding, original transcript, and optional commitment reasoning.

### 2. Backend agent loop

Nanoclaw/OpenClaw acts as the deeper reasoning layer. It reads from the same Supabase tables as the app and writes daily guidance back into:

```sql
public.focus_recommendations
```

Renaissance renders:

- `narrative` as the daily nudge
- `recommended_focus_thought_id` as the linked thought or commitment
- `recommended_focus_reason` as the explanation for why this surfaced now
- `starter_step` as a concrete 5-minute action
- `spirit_animal_title`, `spirit_animal_reason`, and `spirit_animal_prescription` as the current symbolic read

If the backend has not written a row, the app falls back to local heuristics. When the backend is active, the experience becomes significantly more personal because it is reading from a longer-lived memory.

## Data Model Thinking

Renaissance is opinionated about what should be remembered.

- `entries` hold captured thoughts, categories, energy, content, insight, and embeddings.
- `commitments` track which thoughts became promises and whether they moved.
- `commitment_events` record progress against those promises.
- `focus_recommendations` stores backend-authored nudges by date and phase.
- `client_error_logs` preserve runtime failures for debugging.
- Compass values keep high-level direction available to both app and backend.

The database is not just storage. It is the shared memory layer between the user interface and the agentic backend.

## Taxonomy

Captured thoughts are classified into a deliberately human taxonomy:

- `vitality` - relationships, health, nature, exercise, social connection
- `momentum` - admin, errands, chores, maintenance, life machinery
- `vent` - emotional processing and frustration
- `logic` - systems thinking, theories, analysis
- `dream` - aspiration, creative direction, future self
- `kitchen` - recipes, food memory, heritage, Kuli's Kitchen

Energy is tracked as `high`, `low`, or `zombie`, because the same idea means something different depending on the body it arrives in.

## Tech Stack

- Expo 54
- React Native 0.81
- React 19
- TypeScript
- Supabase Postgres, Edge Functions, and embedding storage
- OpenAI-compatible server-side AI function
- AsyncStorage for local state
- GitHub Actions and EAS for preview publishing

## Getting Started

```bash
npm install
cp .env.example .env
npm start
```

Required runtime config:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Backend secrets such as `OPENAI_API_KEY`, Supabase service-role keys, and database credentials belong only in Supabase functions, Nanoclaw/OpenClaw, or GitHub secrets.

## Supporting Workflows

- `OPENCLAW_RENAISSANCE_INTEGRATION.md` defines the backend nudge contract.
- `scripts/focus-recommendations.sql` creates the backend-to-app recommendation table.
- `scripts/commitments-v2.sql` extends the accountability model.
- `scripts/process-embeddings.mjs` backfills missing embeddings.
- `scripts/smoke-ai.mjs` verifies the AI function path.
- `.github/workflows/preview.yml` publishes EAS updates.
- `.github/workflows/process-embeddings.yml` runs server-side embedding maintenance.

## Repository Map

- `App.tsx` - capture, mirror, focus, spirit animal, archive, and commitments UI
- `lib/openai.ts` - AI function client and fallback intelligence
- `lib/supabase.ts` - shared memory access layer
- `lib/values.ts` - values-action gap and values mirror logic
- `src/config/renaissance.json` - taxonomy, product language, colours, and persona
- `scripts/` - Supabase schema and maintenance utilities

## Security Posture

- Real `.env` files are ignored.
- `EXPO_PUBLIC_*` values are bundled into the app and treated as public runtime config.
- Provider keys, Supabase service-role keys, and database credentials stay server-side.
- If a Supabase anon key was ever committed, rotate it or issue a fresh public anon key before relying on the public repo.

## Why This Is Portfolio-Relevant

Renaissance demonstrates a complete AI product loop: mobile voice UX, structured memory, embeddings, server-side AI orchestration, agent-authored guidance, symbolic pattern feedback, commitment tracking, and a front end that makes backend intelligence feel present in daily life.
