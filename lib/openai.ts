import renaissanceConfig from '../src/config/renaissance.json';

export interface ExtractedItem {
  title: string;
  type: 'vitality' | 'momentum' | 'vent' | 'logic' | 'dream' | 'kitchen';
  energy: 'high' | 'low' | 'zombie';
  strategic_insight: string;
}

export interface ProcessedThought {
  title: string;
  category: string;
  insight: string;
  energy: 'high' | 'low' | 'zombie';
  embedding: number[];
  content: string;
}

const getApiKey = () => {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!key || key === 'your_openai_api_key_here') {
    throw new Error('Please set EXPO_PUBLIC_OPENAI_API_KEY in .env');
  }
  return key;
};

// Generate 1536-dimension embedding using text-embedding-3-small
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = getApiKey();

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Embedding API error:', error);
    throw new Error(`Embedding API error: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

export async function transcribeAudio(audioUri: string): Promise<string> {
  const apiKey = getApiKey();
  const formData = new FormData();

  formData.append('file', {
    uri: audioUri,
    type: 'audio/m4a',
    name: 'recording.m4a',
  } as any);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en'); // Force English - fixes Welsh misidentification

  // Add spelling hints from config to help Whisper recognize custom words
  const spellingHints = renaissanceConfig.spellingDictionary.join(', ');
  formData.append('prompt', spellingHints);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API error: ${error}`);
  }

  const data = await response.json();
  return data.text;
}

// The Strategist: Blunt but supportive categorization with GPT-4o-mini
export async function processWithStrategist(transcription: string): Promise<ExtractedItem[]> {
  const apiKey = getApiKey();

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

Return ONLY a JSON array:
[{"title": "concise title", "type": "category", "energy": "level", "strategic_insight": "blunt 1-sentence insight"}]`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcription },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Strategist API error: ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '[]';

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
  }));
}

// Legacy export for backwards compatibility
export const processWithGPT = processWithStrategist;

export async function generateDailyMirror(ventEntries: { content: string; created_at: string }[]): Promise<string> {
  if (ventEntries.length === 0) {
    return "No thoughts to reflect on today. That's okay too.";
  }

  const apiKey = getApiKey();

  const ventSummary = ventEntries
    .map((entry, i) => `${i + 1}. "${entry.content}"`)
    .join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a blunt but caring companion. Given yesterday's vent entries, provide a 2-sentence synthesis. Be direct. Acknowledge without coddling. Speak to them like a wise friend who doesn't sugarcoat.`
        },
        {
          role: 'user',
          content: `Yesterday's processing:\n\n${ventSummary}`
        },
      ],
      temperature: 0.8,
      max_tokens: 150,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Morning Mirror generation error:', error);
    return "Yesterday happened. Today's a new shot.";
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "Your feelings are valid. Now, what's next?";
}

// Export config for use in other files
export { renaissanceConfig };
