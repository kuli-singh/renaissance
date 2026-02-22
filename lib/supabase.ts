import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Supabase credentials not found in .env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export interface Commitment {
  id: string;
  thought_id: string;
  status: 'open' | 'completed' | 'abandoned';
  reasoning?: string;
  created_at: string;
  kind?: 'one_off' | 'ongoing';
  cadence?: 'none' | 'daily' | 'weekly' | 'monthly';
  last_progress_at?: string | null;
  progress_count_7d?: number;
  progress_count_30d?: number;
  latest_progress_note?: string | null;
}

export interface Entry {
  id: string;
  title: string;
  type: 'vitality' | 'momentum' | 'vent' | 'logic' | 'dream' | 'kitchen';
  category?: string;
  energy: 'high' | 'low' | 'zombie';
  content?: string;
  insight?: string;
  embedding?: number[];
  strategic_insight?: string;
  raw_transcription?: string;
  transcription?: string;
  body?: string;
  text?: string;
  created_at: string;
}

// Insert thought with vectorized embedding
export async function insertThought(thought: {
  title: string;
  category: string;
  insight: string;
  energy: string;
  content: string;
  embedding: number[];
}): Promise<Entry | null> {
  // Payload mapping:
  // transcription -> content
  // category -> category
  // insight -> insight
  // embedding -> embedding (numeric array for pgvector)
  const payload = {
    title: thought.title,
    type: thought.category,
    energy: thought.energy,
    content: thought.content,      // transcription text
    category: thought.category,
    insight: thought.insight,
    embedding: thought.embedding,  // numeric array (pgvector accepts this)
  };

  console.log('[Supabase] Saving:', thought.title, '| Category:', thought.category);

  const { data, error } = await supabase
    .from('entries')
    .insert([payload])
    .select();

  if (error) {
    console.error('[Supabase] Error:', error.message);
    if (error.hint) console.error('[Supabase] Hint:', error.hint);

    // Fallback without embedding/insight columns
    const fallbackPayload = {
      title: thought.title,
      type: thought.category,
      energy: thought.energy,
      content: thought.content,
    };

    const fallbackResult = await supabase
      .from('entries')
      .insert([fallbackPayload])
      .select();

    if (fallbackResult.error) {
      console.error('[Supabase] Fallback failed:', fallbackResult.error.message);
      return null;
    }

    console.log('[Supabase] Saved (fallback):', fallbackResult.data?.[0]?.id);
    return fallbackResult.data?.[0] || null;
  }

  console.log('[Supabase] Saved:', data?.[0]?.id);
  return data?.[0] || null;
}

// Legacy insert function (backwards compatible)
export async function insertEntry(entry: {
  title: string;
  type: string;
  energy: string;
  raw_transcription?: string;
}): Promise<Entry | null> {
  const insertData = {
    title: entry.title,
    type: entry.type,
    energy: entry.energy,
    content: entry.raw_transcription,
  };

  console.log('=== INSERTING TO SUPABASE ===');
  console.log('Insert data:', JSON.stringify(insertData, null, 2));

  const { data, error } = await supabase
    .from('entries')
    .insert(insertData)
    .select('*')
    .single();

  if (error) {
    console.error('=== SUPABASE INSERT ERROR ===');
    console.error('Error:', error.message);
    console.error('Details:', error.details);
    console.error('Hint:', error.hint);
    return null;
  }

  console.log('=== SUPABASE INSERT SUCCESS ===');
  console.log('Returned data:', JSON.stringify(data, null, 2));

  return data;
}

export async function fetchEntries(): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('=== SUPABASE FETCH ERROR ===');
    console.error('Error:', error.message);
    return [];
  }

  console.log('=== SUPABASE FETCH SUCCESS ===');
  console.log('Fetched', data?.length || 0, 'entries');

  return data || [];
}

export async function fetchTodaysVents(): Promise<Entry[]> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('type', 'vent')
    .gte('created_at', `${today}T00:00:00`)
    .lte('created_at', `${today}T23:59:59`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching vents:', error.message);
    return [];
  }

  return data || [];
}

export async function fetchYesterdaysVents(): Promise<Entry[]> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('type', 'vent')
    .gte('created_at', `${yesterdayStr}T00:00:00`)
    .lte('created_at', `${yesterdayStr}T23:59:59`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching yesterday vents:', error.message);
    return [];
  }

  return data || [];
}

// ── Commitments ──────────────────────────────────────────────────────────────

export async function fetchCommitments(): Promise<Commitment[]> {
  const { data, error } = await supabase
    .from('commitments')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching commitments:', error.message);
    return [];
  }
  return data || [];
}

export async function createCommitment(
  thoughtId: string,
  reasoning?: string
): Promise<Commitment | null> {
  const { data, error } = await supabase
    .from('commitments')
    .insert([{ thought_id: thoughtId, status: 'open', reasoning: reasoning || null }])
    .select()
    .single();

  if (error) {
    console.error('Error creating commitment:', error.message);
    return null;
  }
  return data;
}

export async function updateCommitmentStatus(
  id: string,
  status: 'open' | 'completed' | 'abandoned'
): Promise<boolean> {
  const { error } = await supabase
    .from('commitments')
    .update({ status })
    .eq('id', id);

  if (error) {
    console.error('Error updating commitment:', error.message);
    return false;
  }
  return true;
}

export async function logCommitmentProgress(
  id: string,
  note?: string
): Promise<Commitment | null> {
  const { data: existing, error: fetchError } = await supabase
    .from('commitments')
    .select('id,progress_count_7d,progress_count_30d')
    .eq('id', id)
    .single();

  if (fetchError || !existing) {
    console.error('Error loading commitment progress fields:', fetchError?.message);
    return null;
  }

  const payload = {
    last_progress_at: new Date().toISOString(),
    progress_count_7d: (existing.progress_count_7d || 0) + 1,
    progress_count_30d: (existing.progress_count_30d || 0) + 1,
    latest_progress_note: note || null,
  };

  const { data, error } = await supabase
    .from('commitments')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.error('Error logging commitment progress:', error.message);
    return null;
  }

  return data;
}

// ── Spirit Animal ─────────────────────────────────────────────────────────────

export async function getTodaysSpiritAnimal(): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('entries')
    .select('type, energy')
    .gte('created_at', `${today}T00:00:00`)
    .lte('created_at', `${today}T23:59:59`);

  if (error || !data || data.length === 0) {
    return '🐢 Steady Turtle';
  }

  const ventCount = data.filter(e => e.type === 'vent').length;
  const momentumCount = data.filter(e => e.type === 'momentum').length;
  const dreamCount = data.filter(e => e.type === 'dream').length;
  const vitalityCount = data.filter(e => e.type === 'vitality').length;
  const zombieCount = data.filter(e => e.energy === 'zombie').length;
  const highCount = data.filter(e => e.energy === 'high').length;

  if (zombieCount > data.length / 2) {
    return '🦥 Sleepy Sloth';
  }
  if (ventCount > momentumCount && ventCount > dreamCount) {
    return '🐉 Processing Dragon';
  }
  if (vitalityCount > momentumCount) {
    return '🌿 Forest Walker';
  }
  if (dreamCount > momentumCount) {
    return '🦅 Dreaming Eagle';
  }
  if (highCount > data.length / 2) {
    return '⚡ Lightning Fox';
  }
  if (momentumCount >= 3) {
    return '🐝 Busy Bee';
  }

  return '🐢 Steady Turtle';
}
