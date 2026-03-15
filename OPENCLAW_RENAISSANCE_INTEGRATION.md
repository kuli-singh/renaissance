# OpenClaw -> Renaissance Integration

This document defines how OpenClaw should feed Renaissance's `Focus` experience.

## Goal

OpenClaw already generates high-quality morning and evening nudges from the same Supabase data Renaissance uses.

Renaissance now has a `Focus` layer that can display:

- a narrative nudge
- a recommended focus item
- a reason the item was chosen
- a 5-minute starter step

The integration point is the `public.focus_recommendations` table.

OpenClaw should write into that table after generating a Renaissance-focused nudge.

## Daily Vs Weekly

OpenClaw should not treat every good reflection as a daily nudge.

There are two different products here:

- `Daily focus nudge`
- `Weekly reflection`

They serve different jobs.

### Daily focus nudge

This is what belongs in `public.focus_recommendations`.

It should:

- help Kuli act today
- pick one focus item
- explain why it matters in one compact reason
- give one concrete starter step
- keep the narrative short enough to read quickly in-app

It should not:

- become a long essay
- review the whole week
- carry multiple competing themes
- end with several possible actions

Rule of thumb:

- if it helps answer `what do I do next today?`, it belongs here

### Weekly reflection

This should stay separate from `focus_recommendations`.

It should:

- look across multiple days
- identify values patterns
- name recurring tensions and values-action gaps
- synthesize stale commitments and drift
- help with meaning, not just immediate action

Rule of thumb:

- if it mainly helps answer `what story am I living lately?`, it is a weekly reflection, not a daily nudge

### Practical instruction for OpenClaw

When generating a Renaissance nudge:

1. Do the deeper reflection if useful.
2. Compress it into a true daily output for `focus_recommendations`.
3. Keep the fuller commentary in OpenClaw memory or a later weekly artifact.

The app should receive the compressed daily form, not the whole essay.

## Contract

Renaissance reads the latest row for `focus_date = current_date`.

Preferred fields for each row:

- `focus_date`
- `phase` as `morning`, `midday`, or `evening`
- `recommended_focus_thought_id` nullable, but strongly preferred
- `recommended_focus_reason`
- `starter_step`
- `narrative`

Time semantics:

- `focus_date` means the date the nudge should appear in Renaissance
- `phase` means the phase of that same date

Examples:

- tonight's reflection shown tonight:
  - `focus_date = current_date`
  - `phase = evening`
- tomorrow morning's nudge shown tomorrow morning:
  - `focus_date = tomorrow`
  - `phase = morning`

Do not use `phase = evening` for a row intended to appear tomorrow morning.

Renaissance behavior:

- If a row exists, `Focus` and `Capture` render the narrative and starter step.
- If `recommended_focus_thought_id` is set, Renaissance prioritizes that commitment.
- If no row exists, Renaissance falls back to local heuristics.

## Minimal Write Flow

1. Query recent Renaissance entries and open commitments from Supabase.
2. Generate a Renaissance nudge.
3. Choose one best focus item if possible.
4. Write one row to `public.focus_recommendations`.
5. Update OpenClaw's Renaissance memory from the DB snapshot used to generate the nudge.

## SQL Write Pattern

Use delete-then-insert per `focus_date` + `phase`.

```sql
delete from public.focus_recommendations
where focus_date = current_date
  and coalesce(phase, 'none') = 'morning';

insert into public.focus_recommendations (
  focus_date,
  recommended_focus_thought_id,
  recommended_focus_reason,
  starter_step,
  narrative,
  phase
) values (
  current_date,
  :thought_id_or_null,
  :reason,
  :starter_step,
  :narrative,
  'morning'
);
```

Repeat with `midday` or `evening` as needed.

## Choosing `recommended_focus_thought_id`

If possible, choose a real open commitment thought ID from:

```sql
select c.thought_id, e.title, c.created_at, c.last_progress_at
from public.commitments c
join public.entries e on e.id = c.thought_id
where c.status = 'open'
order by c.created_at asc;
```

Rules:

- Prefer one of the open commitments.
- Prefer older commitments that still match recurring values.
- Prefer something the user can move with one concrete action.
- If no clean match exists, set `recommended_focus_thought_id` to `null`.

## Tone

The nudge should be:

- loving but hard to ignore
- specific
- lightly challenging
- non-shaming
- action-shaping

The nudge should not:

- sound like a generic productivity app
- list too many things
- moralize or guilt-trip
- repeat vague reminders

## Daily Nudge Format

OpenClaw should compress its commentary into this shape before writing to `focus_recommendations`:

- `narrative`
  - 2 to 4 sentences max
  - enough context to feel personal
  - no sprawling review
- `recommended_focus_reason`
  - 1 compact paragraph or 1 to 2 sentences
  - why this item, now
- `starter_step`
  - 1 very concrete action
  - small enough to start immediately

Good daily nudge example:

```text
Friday ended in depletion and then a hard pivot into aspiration. The part that needs answering first is the depletion, not the ambition. Gym tomorrow morning is the clearest values anchor in the data.
```

Good reason example:

```text
Your recent entries keep pointing to vitality as a stabilizer, and this is the lowest-friction way to reset after a draining week.
```

Good starter step example:

```text
Go to the gym before anything else. Coffee and Rome prep afterwards.
```

### What to keep out of the daily payload

These belong in weekly reflection or memory, not the app's daily nudge:

- broad life pattern analysis across many days
- long commentary on identity
- multiple unresolved themes in one message
- reflective passages that do not narrow to one move

## Suggested Output Shape

OpenClaw should internally generate something like:

```json
{
  "phase": "morning",
  "recommended_focus_thought_id": "uuid-or-null",
  "recommended_focus_reason": "Connection and contribution keep showing up in recent thoughts, but this older commitment has not moved.",
  "starter_step": "Open the draft and write three bullet points.",
  "narrative": "Good Sunday, Kuli. Two entries today told the same story together...",
  "values_summary": "Connection and contribution are recurring. Stability is getting more action than connection."
}
```

`values_summary` is useful for OpenClaw's own memory even though Renaissance does not currently require it in the table.

## OpenClaw Memory Update

OpenClaw keeps a separate Renaissance memory derived from the DB.

After generating a nudge, update that memory using the same DB snapshot the nudge was based on.

The memory should track:

- recurring values in recent thoughts
- current spirit-animal-relevant pattern
- oldest open commitments
- commitments that have stalled
- latest chosen focus item
- whether the user's recent actions align with stated values

Recommended memory sections:

- `emergent_values`
- `values_action_gap`
- `stale_commitments`
- `current_focus`
- `recent_alignment_examples`
- `weekly_reflection_notes`

Example memory summary:

```text
Emergent values: connection, contribution, vitality.
Values-action gap: connection is strongly present in thoughts but underrepresented in moved commitments.
Stale commitments: Kuli's Kitchen posts, AI community engagement, community dinner.
Current focus: AI community engagement.
Starter step: Send one message or draft three bullets.
Recent alignment example: family presence showed up in both reflection and lived action.
```

## Suggested Weekly Reflection Artifact

This does not need to be implemented in Renaissance yet, but OpenClaw should think in these terms.

Weekly reflection output should include:

- strongest emergent values
- values-action mismatches
- commitments that moved
- commitments that stalled
- one focus for the next week

That weekly artifact can stay in OpenClaw memory for now. Later it can become a separate table such as `weekly_reflections`.

## When To Write

Recommended schedule:

- Morning: yes
- Midday: optional, can be left to Renaissance local heuristics
- Evening: yes

Recommended practical setup:

- OpenClaw writes `morning` and `evening` for the same day those nudges should appear
- Renaissance handles in-between focus behavior locally

This keeps the system resilient. Renaissance does not depend on OpenClaw, but becomes more personal when OpenClaw writes recommendations.

## Current App State

Renaissance already supports:

- local `Focus` fallback without OpenClaw
- shared values heuristics in `lib/values.ts`
- backend-aware `Focus` rendering from `public.focus_recommendations`
- `Capture` preview of the current nudge

So OpenClaw only needs to write the row correctly and keep its memory in sync.
