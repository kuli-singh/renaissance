export interface ParsedWorkoutLog {
  exercise: string | null;
  set: number | null;
  reps: number | null;
  weight: number | null;
  weightUnit: 'lb' | 'kg' | null;
  notes: string;
}

const EXTRA_NOTE_HINTS = [
  'hard',
  'easy',
  'heavy',
  'light',
  'pain',
  'hurt',
  'ache',
  'sore',
  'burn',
  'cramp',
  'tight',
  'strain',
  'tweak',
  'grind',
  'grinder',
  'failed',
  'missed',
  'cheat',
  'strict',
  'swing',
  'tempo',
  'slow',
  'fast',
  'paused',
  'pause',
  'form',
  'depth',
  'range',
  'left',
  'right',
  'unstable',
  'shaky',
  'stuck',
  'rest',
  'breath',
];

const normalizeText = (value: string | null | undefined) => (
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const sanitizeNotes = (notes: string | null | undefined, parsed: Omit<ParsedWorkoutLog, 'notes'>, transcription: string) => {
  const trimmed = (notes || '').trim();
  if (!trimmed) return '';

  const normalizedNotes = normalizeText(trimmed);
  const normalizedTranscript = normalizeText(transcription);

  if (!normalizedNotes || normalizedNotes === normalizedTranscript) {
    return '';
  }

  const structuredTokens = [
    parsed.exercise,
    parsed.set != null ? `set ${parsed.set}` : null,
    parsed.reps != null ? `${parsed.reps}` : null,
    parsed.reps != null ? `${parsed.reps} reps` : null,
    parsed.weight != null ? `${parsed.weight}` : null,
    parsed.weight != null && parsed.weightUnit ? `${parsed.weight} ${parsed.weightUnit}` : null,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(String(value)));

  const strippedNotes = structuredTokens.reduce(
    (current, token) => current.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' '),
    normalizedNotes
  ).replace(/\s+/g, ' ').trim();

  if (!strippedNotes) {
    return '';
  }

  const hasExtraSignal = EXTRA_NOTE_HINTS.some((hint) => strippedNotes.includes(hint));
  return hasExtraSignal ? trimmed : '';
};

const getApiKey = () => {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!key || key === 'your_openai_api_key_here') {
    throw new Error('Please set EXPO_PUBLIC_OPENAI_API_KEY');
  }
  return key;
};

export async function transcribeAudio(audioUri: string): Promise<string> {
  const apiKey = getApiKey();
  const formData = new FormData();

  formData.append('file', {
    uri: audioUri,
    type: 'audio/m4a',
    name: 'workout-recording.m4a',
  } as any);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  formData.append('prompt', 'Gym workout log. Exercise, set, reps, weight, notes, effort, pain, rest.');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

export async function parseWorkoutLog(transcription: string): Promise<ParsedWorkoutLog> {
  const apiKey = getApiKey();
  const systemPrompt = `You extract a single workout log row from spoken gym shorthand.

Return only one JSON object with this exact shape:
{"exercise":"string","set":number|null,"reps":number|null,"weight":number|null,"weightUnit":"lb"|"kg"|null,"notes":"string"}

Rules:
- "exercise" should be the spoken exercise when present. If the user does not mention an exercise, set it to null.
- "set" should be the spoken set number when present, otherwise null.
- "reps" should be the rep count when present, otherwise null.
- "weight" should be numeric only, without units, when present.
- "weightUnit" should be "lb" or "kg" when clear, otherwise null.
- "notes" should be an empty string unless the speech includes extra qualitative context not already captured by exercise, set, reps, or weight.
- Only keep notes for genuinely additional details like effort, pain, tempo, side-specific issues, missed reps, or uncertainty.
- If the user says multiple sets, extract the main/latest set being described and mention the ambiguity in notes.
- Do not invent values. Use null when unknown.
- Keep notes short and practical.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcription },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Workout parser error: ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '{}';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content) as ParsedWorkoutLog;

    const normalized = {
      exercise: parsed.exercise?.trim() || null,
      set: typeof parsed.set === 'number' ? parsed.set : null,
      reps: typeof parsed.reps === 'number' ? parsed.reps : null,
      weight: typeof parsed.weight === 'number' ? parsed.weight : null,
      weightUnit: parsed.weightUnit === 'lb' || parsed.weightUnit === 'kg' ? parsed.weightUnit : null,
      notes: '',
    };

    return {
      ...normalized,
      notes: sanitizeNotes(parsed.notes, normalized, transcription),
    };
  } catch (error) {
    throw new Error(
      `Workout parser returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
