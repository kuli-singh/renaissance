#!/usr/bin/env node
/**
 * Thought Processor — Backfill & Sync Embeddings (Issue #2)
 *
 * Workflow:
 *   1. Fetch all entries from Supabase where embedding IS NULL
 *   2. Generate a unique 1536-dim vector via OpenAI text-embedding-3-small
 *      (same model used in lib/openai.ts)
 *   3. PATCH each entry back with its embedding
 *
 * Env vars required:
 *   SUPABASE_URL              — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY — admin key (bypasses RLS)
 *   OPENAI_API_KEY            — OpenAI secret key
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

// ── Validation ────────────────────────────────────────────────────────────────
if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error('❌  Missing required env vars:');
  if (!SUPABASE_URL)  console.error('   • SUPABASE_URL');
  if (!SUPABASE_KEY)  console.error('   • SUPABASE_SERVICE_ROLE_KEY');
  if (!OPENAI_KEY)    console.error('   • OPENAI_API_KEY');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch all entries where embedding IS NULL */
async function fetchUnembeddedEntries() {
  const url = `${SUPABASE_URL}/rest/v1/entries?select=id,title,content&embedding=is.null`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase fetch failed: ${res.status} ${err}`);
  }

  return res.json();
}

/** Generate a 1536-dim embedding — mirrors lib/openai.ts generateEmbedding() */
async function generateEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.data[0].embedding; // number[]
}

/** Patch a single entry's embedding back to Supabase */
async function patchEmbedding(id, embedding) {
  const url = `${SUPABASE_URL}/rest/v1/entries?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ embedding }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase patch failed for ${id}: ${res.status} ${err}`);
  }
}

/** Build the text to embed — mirrors the pattern in lib/openai.ts processThought() */
function buildEmbedText(entry) {
  const title   = (entry.title   || '').trim();
  const content = (entry.content || '').trim();
  if (title && content) return `${title}. ${content}`;
  return title || content || 'untitled entry';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🧠  Thought Processor — Embedding Sync');
  console.log(`📡  Supabase: ${SUPABASE_URL}`);
  console.log('');

  // Step 1: Find entries that need embeddings
  const entries = await fetchUnembeddedEntries();
  console.log(`🔍  Found ${entries.length} entries without embeddings`);

  if (entries.length === 0) {
    console.log('✅  Nothing to do — all entries already have embeddings.');
    return;
  }

  // Step 2 & 3: Embed and write back (sequential to respect rate limits)
  let succeeded = 0;
  let failed    = 0;

  for (const entry of entries) {
    const text = buildEmbedText(entry);
    const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;

    try {
      process.stdout.write(`  ⚙️  [${entry.id.slice(0, 8)}] "${preview}" … `);
      const embedding = await generateEmbedding(text);
      await patchEmbedding(entry.id, embedding);
      console.log('✓');
      succeeded++;
    } catch (err) {
      console.log(`✗ (${err.message})`);
      failed++;
    }
  }

  console.log('');
  console.log(`📊  Done: ${succeeded} updated, ${failed} failed`);

  if (failed > 0) {
    process.exit(1); // Fail the CI job so we know to investigate
  }
}

main().catch(err => {
  console.error('💥  Fatal error:', err.message);
  process.exit(1);
});
