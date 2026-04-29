import renaissanceConfig from '../src/config/renaissance.json';
import { env, getSupabaseFunctionUrl } from './env';
import { deriveStarterStep, deriveValueInsights } from './values';

export interface ExtractedItem {
  title: string;
  type: 'vitality' | 'momentum' | 'vent' | 'logic' | 'dream' | 'kitchen';
  energy: 'high' | 'low' | 'zombie';
  strategic_insight: string;
  suggest_commitment?: boolean;
  commitment_reasoning?: string | null;
}

export interface ProcessedThought {
  title: string;
  category: string;
  insight: string;
  energy: 'high' | 'low' | 'zombie';
  embedding: number[];
  content: string;
  suggestCommitment: boolean;
  commitmentReasoning?: string | null;
}

export interface FocusRecommendationContextItem {
  title: string;
  type: string;
  energy: string;
  created_at?: string;
}

export interface FocusRecommendationContext {
  phase: 'morning' | 'midday' | 'evening';
  northStar?: string | null;
  weeklyFocus?: string | null;
  spiritAnimal?: string | null;
  recentEntries: FocusRecommendationContextItem[];
  openCommitments: FocusRecommendationContextItem[];
}

export interface GeneratedFocusRecommendation {
  recommended_focus_title: string | null;
  recommended_focus_reason: string;
  starter_step: string;
  narrative: string;
  phase: 'morning' | 'midday' | 'evening';
  values_summary: string;
}

const AI_FUNCTION_NAME = 'openai';

const getAudioUploadMetadata = (audioUri: string) => {
  const sanitizedUri = audioUri.split('?')[0].toLowerCase();
  const extension = sanitizedUri.includes('.') ? sanitizedUri.slice(sanitizedUri.lastIndexOf('.') + 1) : '';

  switch (extension) {
    case 'm4a':
    case 'mp4':
      return { name: `recording.${extension}`, type: 'audio/mp4' };
    case 'caf':
      return { name: 'recording.caf', type: 'audio/x-caf' };
    case 'wav':
      return { name: 'recording.wav', type: 'audio/wav' };
    case 'mp3':
      return { name: 'recording.mp3', type: 'audio/mpeg' };
    case 'aac':
      return { name: 'recording.aac', type: 'audio/aac' };
    case '3gp':
      return { name: 'recording.3gp', type: 'audio/3gpp' };
    case 'amr':
      return { name: 'recording.amr', type: 'audio/amr' };
    default:
      return { name: 'recording.m4a', type: 'audio/mp4' };
  }
};

const getAiFunctionHeaders = (includeJsonContentType = true): Record<string, string> => {
  const headers: Record<string, string> = {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${env.supabaseAnonKey}`,
  };

  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `AI function error (${response.status})`);
  }

  return response.json() as Promise<T>;
};

const invokeAiJson = async <T>(payload: Record<string, unknown>): Promise<T> => {
  const response = await fetch(getSupabaseFunctionUrl(AI_FUNCTION_NAME), {
    method: 'POST',
    headers: getAiFunctionHeaders(),
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<T>(response);
};

// Generate 1536-dimension embedding using text-embedding-3-small
export async function generateEmbedding(text: string): Promise<number[]> {
  const data = await invokeAiJson<{ embedding: number[] }>({
    action: 'embedding',
    input: text,
  });
  return data.embedding;
}

export async function transcribeAudio(audioUri: string): Promise<string> {
  const formData = new FormData();
  const metadata = getAudioUploadMetadata(audioUri);

  formData.append('file', {
    uri: audioUri,
    type: metadata.type,
    name: metadata.name,
  } as any);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en'); // Force English - fixes Welsh misidentification

  // Add spelling hints from config to help Whisper recognize custom words
  const spellingHints = renaissanceConfig.spellingDictionary.join(', ');
  formData.append('prompt', spellingHints);
  formData.append('action', 'transcribe');

  try {
    const response = await fetch(getSupabaseFunctionUrl(AI_FUNCTION_NAME), {
      method: 'POST',
      headers: getAiFunctionHeaders(false),
      body: formData,
    });

    const data = await parseJsonResponse<{ text: string }>(response);
    return data.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} [upload=${metadata.name} ${metadata.type}]`);
  }
}

// The Strategist: Blunt but supportive categorization with GPT-4o-mini
export async function processWithStrategist(transcription: string): Promise<ExtractedItem[]> {
  const systemPrompt = `You are the "Renaissance Strategist" - a blunt but supportive high-level personal assistant for "The Steady Turtle."

Your job: Cut through the noise. Categorize thoughts. Connect them to growth.

CATEGORIES (pick ONE per thought):
- "vitality": People, relationships, nature, health, exercise, social connection. The stuff that actually keeps you alive.
- "momentum": Boring but necessary. Admin, errands, maintenance. The gears that keep life moving.
- "vent": Emotional dumps. Frustration. Processing. Let it out.
- "logic": Abstract thinking. Theories. Deep analysis. Your brain doing brain things.
- "dream": Goals. Visions. Creative sparks. Where you're headed.
- "kitchen": Recipes. Food. Heritage. Kuli's Kitchen territory.

ENERGY LEVELS:
- "high": Fired up, motivated
- "low": Calm, steady, neutral
- "zombie": Running on fumes

RULES:
- Be blunt. No fluff.
- The "strategic_insight" must connect this thought to overall well-being or growth in ONE sentence.
- Example insight: "This errand is blocking three bigger things - knock it out."
- Extract the ESSENCE, not the rambling.
- Set "suggest_commitment" to true only when the thought implies a concrete action, promise, follow-up, or accountable next step.
- Keep "suggest_commitment" false for pure vents, pure reflection, or abstract observations with no clear action.
- If "suggest_commitment" is true, add a short "commitment_reasoning" sentence explaining why this should become a commitment.
- If "suggest_commitment" is false, set "commitment_reasoning" to null.

Return ONLY a JSON array:
[{"title": "concise title", "type": "category", "energy": "level", "strategic_insight": "blunt 1-sentence insight", "suggest_commitment": false, "commitment_reasoning": null}]`;

  const data = await invokeAiJson<{ content: string }>({
    action: 'chat',
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcription },
    ],
    temperature: 0.7,
  });
  const content = data.content || '[]';

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch {
    console.error('Failed to parse Strategist response:', content);
    return [];
  }
}

// Full processing pipeline: Transcribe → Strategist → Embed
// Each extracted thought gets its own embedding based on its specific title + content,
// not a shared embedding of the full transcription.
export async function processThought(transcription: string): Promise<ProcessedThought[]> {
  // Step 1: Categorise all thoughts first
  const items = await processWithStrategist(transcription);

  if (items.length === 0) return [];

  // Step 2: Generate a unique embedding per thought using its title + content
  const embeddings = await Promise.all(
    items.map(item =>
      generateEmbedding(`${item.title}. ${transcription}`)
    )
  );

  return items.map((item, index) => ({
    title: item.title,
    category: item.type,
    insight: item.strategic_insight,
    energy: item.energy,
    embedding: embeddings[index],
    content: transcription,
    suggestCommitment: !!item.suggest_commitment,
    commitmentReasoning: item.commitment_reasoning || null,
  }));
}

// Legacy export for backwards compatibility
export const processWithGPT = processWithStrategist;

export async function generateDailyMirror(entries: {
  title: string;
  type: string;
  energy: string;
  content?: string;
  insight?: string;
  created_at: string;
}[]): Promise<string> {
  if (entries.length === 0) {
    return "Yesterday was quiet. Treat that as data, not failure. Pick one deliberate move for today.";
  }

  const daySummary = entries
    .map((entry, i) => {
      const detail = entry.content || entry.insight || entry.title;
      return `${i + 1}. [${entry.type} | ${entry.energy}] ${entry.title}: "${detail}"`;
    })
    .join('\n');

  try {
    const data = await invokeAiJson<{ content: string }>({
      action: 'chat',
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a blunt but caring companion. Given a full day of captured thoughts, write a holistic daily mirror in 3 short sentences.
Sentence 1: name the dominant emotional or practical themes.
Sentence 2: reflect the day's energy and any tension or contradiction.
Sentence 3: give one grounded focus for today.
Use the full day, not just vents. Be direct, humane, and specific. Do not sound mystical or esoteric.`
        },
        {
          role: 'user',
          content: `Yesterday's capture log:\n\n${daySummary}`
        },
      ],
      temperature: 0.8,
      max_tokens: 220,
    });

    return data.content || "Your feelings are valid. Now, what's next?";
  } catch (error) {
    console.error('Morning Mirror generation error:', error);
    return "Yesterday happened. Today's a new shot.";
  }
}

export const buildFocusRecommendationPrompt = (context: FocusRecommendationContext) => {
  const { topValues, valueGap, valuesMirrorText } = deriveValueInsights(
    context.recentEntries,
    context.openCommitments
  );

  const valuesSummary = topValues.length > 0
    ? topValues.map((value) => `${value.label} (recent ${value.recentScore}, commitments ${value.commitmentScore})`).join(', ')
    : 'No strong recurring values detected yet.';

  const recentEntriesSummary = context.recentEntries
    .slice(0, 12)
    .map((entry, i) => `${i + 1}. [${entry.type} | ${entry.energy}] ${entry.title}`)
    .join('\n');

  const openCommitmentsSummary = context.openCommitments
    .slice(0, 12)
    .map((entry, i) => `${i + 1}. [${entry.type} | ${entry.energy}] ${entry.title}`)
    .join('\n');

  const systemPrompt = `You are the Renaissance Focus Guide. You write loving but hard-to-ignore nudges for an ADHD user.

Your job:
- Notice the strongest recurring values in recent thoughts
- Compare them against open commitments
- Name the gap without shaming
- Pick one focus item
- Shrink it to a 5-minute starter step

Rules:
- Be concrete, not vague
- Be warm, but never saccharine
- Do not nag
- If the user's values and commitments are misaligned, say so plainly
- Prefer one actionable move over general motivation
- The narrative should sound human and specific, like a real companion

Return ONLY valid JSON with this exact shape:
{"recommended_focus_title":"string or null","recommended_focus_reason":"string","starter_step":"string","narrative":"string","phase":"morning|midday|evening","values_summary":"string"}`;

  const userPrompt = `Phase: ${context.phase}
North Star: ${context.northStar || 'None set'}
Weekly Focus: ${context.weeklyFocus || 'None set'}
Spirit Animal: ${context.spiritAnimal || 'Unknown'}

Recent thought values summary:
${valuesSummary}

Values mirror:
${valuesMirrorText}

Largest values-action gap:
${valueGap ? `${valueGap.label} (gap ${valueGap.gap})` : 'No strong gap detected'}

Recent entries:
${recentEntriesSummary || 'None'}

Open commitments:
${openCommitmentsSummary || 'None'}

If you choose a focus title that appears in the open commitments list, keep the wording close enough to match it.
If you cannot find a good existing focus title, set recommended_focus_title to null and still provide a strong narrative and starter step.
For the starter step, prefer the smallest visible action. Example pattern: "${context.openCommitments[0] ? deriveStarterStep(context.openCommitments[0].title) : 'Open a note and define the smallest possible start.'}"`;

  return { systemPrompt, userPrompt, valuesSummary, valuesMirrorText };
};

export async function generateFocusRecommendation(
  context: FocusRecommendationContext
): Promise<GeneratedFocusRecommendation | null> {
  const { systemPrompt, userPrompt, valuesSummary } = buildFocusRecommendationPrompt(context);
  let content = '{}';

  try {
    const data = await invokeAiJson<{ content: string }>({
      action: 'chat',
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 260,
    });
    content = data.content || '{}';
  } catch (error) {
    console.error('Focus recommendation generation error:', error);
    return null;
  }

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    return {
      recommended_focus_title: parsed.recommended_focus_title || null,
      recommended_focus_reason: parsed.recommended_focus_reason || valuesSummary,
      starter_step: parsed.starter_step || (context.openCommitments[0] ? deriveStarterStep(context.openCommitments[0].title) : 'Open a note and define the smallest possible start.'),
      narrative: parsed.narrative || 'One value deserves one concrete move today.',
      phase: parsed.phase || context.phase,
      values_summary: parsed.values_summary || valuesSummary,
    };
  } catch (error) {
    console.error('Failed to parse focus recommendation:', error, content);
    return null;
  }
}

// Export config for use in other files
export { renaissanceConfig };
