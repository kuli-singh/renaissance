# Renaissance

Personal voice-to-text thought capture and life-tracking app for Kuli. Thoughts are recorded by voice, transcribed via Whisper, categorised by GPT-4o-mini, embedded (1536-dim), and saved to Supabase.

## Tech Stack

- **Framework:** React Native + Expo SDK ~54 (managed workflow)
- **Language:** TypeScript
- **Backend:** Supabase (Postgres + RLS + pgvector for embeddings)
- **AI:** OpenAI — Whisper (transcription), GPT-4o-mini (categorisation), text-embedding-3-small (embeddings)
- **Local storage:** AsyncStorage (Compass, check-ins)
- **Builds/OTA:** EAS Build + EAS Update

## Running the App

```bash
npm install
npm start          # Expo dev server (scan QR with Expo Go for quick iteration)
npm run android    # Android emulator
npm run ios        # iOS simulator
```

Env vars go in `.env` (gitignored). Required:
- `EXPO_PUBLIC_OPENAI_API_KEY`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Building & Deploying

```bash
# Build APK (download and sideload to phone)
eas build --profile production --platform android

# Push OTA update (no reinstall needed for JS-only changes)
eas update --branch production --message "description"
```

GitHub Actions (`.github/workflows/preview.yml`) auto-pushes OTA updates to both `preview` and `production` channels on every push to `main`.

EAS versioning is remote — don't set `versionCode` manually in `app.json`.

## Key Files

| File | Purpose |
|---|---|
| `App.tsx` | Main app — all UI and tab logic |
| `lib/openai.ts` | AI pipeline: transcribe → categorise → embed |
| `lib/supabase.ts` | All DB helpers (entries, commitments, spirit animal) |
| `src/config/renaissance.json` | Categories, energy levels, spirit animals, prompts |
| `scripts/process-embeddings.mjs` | Backfill embeddings for entries missing them |

## Conventions

- **Always spell "Kuli"** — not "Kulwinder", "Kully", etc. Whisper misreads it; `fixName()` in App.tsx patches common voice errors.
- **Config-driven:** Categories, icons, colours, and prompts live in `renaissance.json` — don't hardcode them in components.
- **Sequential embedding:** Embeddings are generated per-thought (not per-recording) using `title + full transcription` as the embed text.
- **No test suite** — test via the Expo dev build.
- Architecture is intentionally monolithic (single `App.tsx`). Don't split into separate screen files unless the user asks.
