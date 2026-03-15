export type ValueKey =
  | 'connection'
  | 'vitality'
  | 'creation'
  | 'contribution'
  | 'stability'
  | 'heritage';

export interface ValueSignalItem {
  title?: string | null;
  type?: string | null;
  energy?: string | null;
}

export interface ValueInsight {
  key: ValueKey;
  label: string;
  recentScore: number;
  commitmentScore: number;
  gap: number;
}

const VALUE_SIGNALS: Record<ValueKey, string[]> = {
  connection: ['family', 'nephew', 'friend', 'mum', 'dad', 'brother', 'sister', 'community', 'people', 'relationship', 'together'],
  vitality: ['gym', 'walk', 'sleep', 'health', 'run', 'exercise', 'yoga', 'body', 'rest', 'energy'],
  creation: ['write', 'draft', 'build', 'create', 'post', 'design', 'make', 'record', 'ship'],
  contribution: ['community', 'event', 'dinner', 'engagement', 'help', 'support', 'teach', 'share'],
  stability: ['finance', 'money', 'admin', 'plan', 'organize', 'clean', 'tax', 'budget', 'maintenance'],
  heritage: ['kitchen', 'recipe', 'food', 'heritage', 'tradition', 'cook'],
};

export const VALUE_LABELS: Record<ValueKey, string> = {
  connection: 'Connection',
  vitality: 'Vitality',
  creation: 'Creation',
  contribution: 'Contribution',
  stability: 'Stability',
  heritage: 'Heritage',
};

export const TYPE_VALUE_LENS: Record<string, string> = {
  vitality: 'vitality, relationships, and the parts of life that keep you emotionally alive',
  momentum: 'follow-through, maintenance, and self-respect through boring but necessary action',
  dream: 'creative ambition, identity, and the future you keep pointing toward',
  logic: 'clarity, understanding, and making sense of what matters',
  vent: 'emotional honesty and giving your inner life somewhere truthful to go',
  kitchen: 'heritage, nourishment, and building something warm and lasting',
};

const TYPE_VALUE_BOOSTS: Record<string, ValueKey[]> = {
  vitality: ['vitality', 'connection'],
  momentum: ['stability'],
  dream: ['creation', 'contribution'],
  logic: ['stability'],
  vent: ['connection'],
  kitchen: ['heritage', 'creation'],
};

const fixName = (text?: string | null): string => {
  if (!text) return '';
  return text.replace(/\bBooper\b/gi, 'BUPA');
};

export const deriveStarterStep = (title: string): string => {
  const trimmed = fixName(title).trim().replace(/[.?!]+$/, '');
  if (!trimmed) return 'Spend 5 minutes defining the smallest possible start.';

  const lower = trimmed.toLowerCase();
  if (lower.includes('gym')) return 'Put on gym clothes and leave the house.';
  if (lower.includes('call') || lower.includes('phone')) return `Open your phone and place the call for ${trimmed}.`;
  if (lower.includes('email') || lower.includes('reply')) return `Open your inbox and draft two sentences for ${trimmed}.`;
  if (lower.includes('text') || lower.includes('message')) return `Send the first one-line message for ${trimmed}.`;
  if (lower.includes('write') || lower.includes('draft')) return `Open a note and write three bullets for ${trimmed}.`;
  if (lower.includes('plan') || lower.includes('organize')) return `Open a note and list the first three steps for ${trimmed}.`;
  if (lower.includes('clean') || lower.includes('tidy')) return `Do five minutes of ${trimmed.toLowerCase()}.`;

  return `Spend 5 minutes starting: ${trimmed}.`;
};

export const scoreValueBuckets = (items: ValueSignalItem[]) => {
  const scores: Record<ValueKey, number> = {
    connection: 0,
    vitality: 0,
    creation: 0,
    contribution: 0,
    stability: 0,
    heritage: 0,
  };

  items.forEach((item) => {
    const text = `${fixName(item.title || '')} ${item.type || ''}`.toLowerCase();
    (Object.keys(VALUE_SIGNALS) as ValueKey[]).forEach((key) => {
      VALUE_SIGNALS[key].forEach((token) => {
        if (text.includes(token)) scores[key] += 2;
      });
    });

    (TYPE_VALUE_BOOSTS[item.type || ''] || []).forEach((key) => {
      scores[key] += 2;
    });

    if (item.energy === 'high') {
      (TYPE_VALUE_BOOSTS[item.type || ''] || []).forEach((key) => {
        scores[key] += 1;
      });
    }
  });

  return scores;
};

export const deriveValueInsights = (
  recentItems: ValueSignalItem[],
  commitmentItems: ValueSignalItem[]
) => {
  const recentValueScores = scoreValueBuckets(recentItems);
  const commitmentValueScores = scoreValueBuckets(commitmentItems);
  const topValues = (Object.keys(recentValueScores) as ValueKey[])
    .map((key) => ({
      key,
      label: VALUE_LABELS[key],
      recentScore: recentValueScores[key],
      commitmentScore: commitmentValueScores[key],
      gap: recentValueScores[key] - commitmentValueScores[key],
    }))
    .filter((item) => item.recentScore > 0)
    .sort((a, b) => b.recentScore - a.recentScore)
    .slice(0, 3);

  const topEmergentValue = topValues[0] || null;
  const valueGap = [...topValues].sort((a, b) => b.gap - a.gap)[0] || null;
  const valuesMirrorText = topValues.length === 0
    ? 'Capture a little more before Renaissance tries to infer values. The pattern gets clearer with repetition.'
    : valueGap && valueGap.gap >= 3
      ? `${valueGap.label} is showing up strongly in your thoughts, but much less in your open commitments. That is probably a real values-action gap.`
      : `${topValues.map((item) => item.label).join(', ')} keep recurring in your recent thoughts. Your commitments are at least partially reflecting what matters.`;

  return {
    recentValueScores,
    commitmentValueScores,
    topValues,
    topEmergentValue,
    valueGap,
    valuesMirrorText,
  };
};
