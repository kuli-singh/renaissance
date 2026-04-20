import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env, getPublicEnvError } from './env';

let supabase: ReturnType<typeof createClient<any>> | null = null;

const getSupabase = () => {
  if (supabase) {
    return supabase;
  }

  supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  return supabase;
};

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

export interface FocusRecommendation {
  id: string;
  focus_date: string;
  recommended_focus_thought_id?: string | null;
  recommended_focus_reason?: string | null;
  starter_step?: string | null;
  narrative?: string | null;
  phase?: 'morning' | 'midday' | 'evening' | null;
  created_at?: string;
}

export interface ClientErrorLogInput {
  feature: string;
  stage: string;
  message: string;
  errorName?: string | null;
  errorStack?: string | null;
  context?: Record<string, unknown>;
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

const truncate = (value: string, max = 5000) => (
  value.length > max ? `${value.slice(0, max)}...` : value
);

export async function logClientError(input: ClientErrorLogInput): Promise<void> {
  const configError = getPublicEnvError();
  if (configError) {
    console.warn('[Supabase] Skipping client error log:', configError);
    return;
  }

  const payload = {
    feature: input.feature,
    stage: input.stage,
    message: truncate(input.message, 2000),
    error_name: input.errorName || null,
    error_stack: input.errorStack ? truncate(input.errorStack, 8000) : null,
    context: input.context || {},
  };

  const { error } = await getSupabase()
    .from('client_error_logs')
    .insert([payload]);

  if (error) {
    console.warn('[Supabase] Failed to persist client error log:', error.message);
  }
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

  const { data, error } = await getSupabase()
    .from('entries')
    .insert([payload])
    .select();

  if (error) {
    console.error('[Supabase] Error:', error.message);
    if (error.hint) console.error('[Supabase] Hint:', error.hint);
    await logClientError({
      feature: 'thought_capture',
      stage: 'supabase_insert_primary',
      message: error.message,
      errorName: error.code || 'SupabaseInsertError',
      context: {
        title: thought.title,
        category: thought.category,
        energy: thought.energy,
        hasEmbedding: Array.isArray(thought.embedding),
        embeddingLength: Array.isArray(thought.embedding) ? thought.embedding.length : 0,
        contentLength: thought.content?.length || 0,
        hint: error.hint || null,
        details: error.details || null,
      },
    });

    // Fallback without embedding/insight columns
    const fallbackPayload = {
      title: thought.title,
      type: thought.category,
      energy: thought.energy,
      content: thought.content,
    };

    const fallbackResult = await getSupabase()
      .from('entries')
      .insert([fallbackPayload])
      .select();

    if (fallbackResult.error) {
      console.error('[Supabase] Fallback failed:', fallbackResult.error.message);
      await logClientError({
        feature: 'thought_capture',
        stage: 'supabase_insert_fallback',
        message: fallbackResult.error.message,
        errorName: fallbackResult.error.code || 'SupabaseFallbackInsertError',
        context: {
          title: thought.title,
          category: thought.category,
          energy: thought.energy,
          contentLength: thought.content?.length || 0,
          hint: fallbackResult.error.hint || null,
          details: fallbackResult.error.details || null,
        },
      });
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

  const { data, error } = await getSupabase()
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

export async function deleteEntry(id: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from('entries')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[Supabase] Delete error:', error.message);
    return false;
  }
  return true;
}

export async function fetchEntries(): Promise<Entry[]> {
  const { data, error } = await getSupabase()
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

  const { data, error } = await getSupabase()
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

  const { data, error } = await getSupabase()
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
  const { data, error } = await getSupabase()
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
  const { data, error } = await getSupabase()
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
  const { error } = await getSupabase()
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
  const { data: existing, error: fetchError } = await getSupabase()
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

  const { data, error } = await getSupabase()
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

export async function fetchLatestFocusRecommendation(
  focusDate: string
): Promise<FocusRecommendation | null> {
  const { data, error } = await getSupabase()
    .from('focus_recommendations')
    .select('*')
    .eq('focus_date', focusDate)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('Focus recommendation unavailable:', error.message);
    return null;
  }

  return data || null;
}

export async function fetchFocusRecommendations(
  focusDate: string
): Promise<FocusRecommendation[]> {
  const { data, error } = await getSupabase()
    .from('focus_recommendations')
    .select('*')
    .eq('focus_date', focusDate)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Focus recommendations unavailable:', error.message);
    return [];
  }

  return data || [];
}

// ── User Settings ─────────────────────────────────────────────────────────────

export async function syncCompassToSupabase(northStar: string, weeklyFocus: string): Promise<void> {
  const settings = [
    { key: 'north_star', value: northStar.trim() },
    { key: 'weekly_focus', value: weeklyFocus.trim() },
    { key: 'compass_synced_at', value: new Date().toISOString() },
  ];

  const { error } = await getSupabase()
    .from('user_settings')
    .upsert(settings, { onConflict: 'key' });

  if (error) {
    console.warn('[Supabase] Compass sync failed:', error.message);
  } else {
    console.log('[Supabase] Compass synced to Supabase');
  }
}

// ── Spirit Animal ─────────────────────────────────────────────────────────────

export async function getTodaysSpiritAnimal(): Promise<string> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDate = yesterday.toISOString().split('T')[0];

  const { data, error } = await getSupabase()
    .from('entries')
    .select('type, energy')
    .gte('created_at', `${targetDate}T00:00:00`)
    .lte('created_at', `${targetDate}T23:59:59`);

  if (error || !data || data.length === 0) {
    return '🐢 Steady Turtle';
  }

  const ventCount = data.filter(e => e.type === 'vent').length;
  const momentumCount = data.filter(e => e.type === 'momentum').length;
  const dreamCount = data.filter(e => e.type === 'dream').length;
  const vitalityCount = data.filter(e => e.type === 'vitality').length;
  const logicCount = data.filter(e => e.type === 'logic').length;
  const kitchenCount = data.filter(e => e.type === 'kitchen').length;
  const zombieCount = data.filter(e => e.energy === 'zombie').length;
  const highCount = data.filter(e => e.energy === 'high').length;
  const lowCount = data.filter(e => e.energy === 'low').length;

  const categoryScores = {
    vent: ventCount * 3,
    momentum: momentumCount * 3,
    dream: dreamCount * 3,
    vitality: vitalityCount * 3,
    logic: logicCount * 3,
    kitchen: kitchenCount * 4,
  };

  const dominantCategory = (Object.entries(categoryScores) as Array<[keyof typeof categoryScores, number]>)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  if (zombieCount > data.length / 2) {
    return '😴🦥 Sleepy Sloth';
  }
  if (dominantCategory === 'kitchen' && kitchenCount > 0) {
    return '🍳🐻 Kitchen Bear';
  }
  if (dominantCategory === 'vent') {
    return '🔥🐉 Processing Dragon';
  }
  if (dominantCategory === 'logic' && logicCount > 0) {
    return '🧠🦉 Thinking Owl';
  }
  if (dominantCategory === 'vitality') {
    return '🌿🦌 Forest Deer';
  }
  if (dominantCategory === 'dream') {
    return '✨🦅 Dreaming Eagle';
  }
  if (highCount > data.length / 2) {
    return '⚡🦊 Lightning Fox';
  }
  if (momentumCount >= 3) {
    return '⚙️🐝 Busy Bee';
  }
  if (lowCount >= data.length / 2) {
    return '🐢 Steady Turtle';
  }

  return '🐢 Steady Turtle';
}
