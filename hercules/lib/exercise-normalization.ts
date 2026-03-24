export interface ExerciseMatch {
  canonical: string;
  confidence: 'high' | 'medium' | 'low';
  matchedFrom: string;
}

interface ExerciseAliasGroup {
  canonical: string;
  aliases: string[];
}

const EXERCISE_LIBRARY: ExerciseAliasGroup[] = [
  { canonical: 'Lat Pulldown', aliases: ['lat pulldown', 'lat pull down', 'lat pull town', 'pulldown', 'pull down'] },
  { canonical: 'Seated Cable Row', aliases: ['seated cable row', 'cable row', 'seated row', 'machine row'] },
  { canonical: 'Barbell Squat', aliases: ['squat', 'back squat', 'barbell squat'] },
  { canonical: 'Front Squat', aliases: ['front squat'] },
  { canonical: 'Romanian Deadlift', aliases: ['romanian deadlift', 'rdl', 'romanian dead lift'] },
  { canonical: 'Deadlift', aliases: ['deadlift', 'dead lift'] },
  { canonical: 'Bench Press', aliases: ['bench press', 'bench'] },
  { canonical: 'Incline Dumbbell Press', aliases: ['incline dumbbell press', 'incline press', 'incline dumbbell bench'] },
  { canonical: 'Overhead Press', aliases: ['overhead press', 'shoulder press', 'military press'] },
  { canonical: 'Leg Press', aliases: ['leg press'] },
  { canonical: 'Leg Curl', aliases: ['leg curl', 'hamstring curl'] },
  { canonical: 'Leg Extension', aliases: ['leg extension', 'quad extension'] },
  { canonical: 'Lateral Raise', aliases: ['lateral raise', 'side raise'] },
  { canonical: 'Bicep Curl', aliases: ['bicep curl', 'curl', 'dumbbell curl', 'barbell curl'] },
  { canonical: 'Tricep Pushdown', aliases: ['tricep pushdown', 'tricep pressdown', 'pushdown', 'pressdown'] },
  { canonical: 'Calf Raise', aliases: ['calf raise', 'standing calf raise', 'seated calf raise'] },
];

const normalizeText = (value: string) => (
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const levenshtein = (a: string, b: string) => {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
};

export const findClosestExercise = (rawExercise: string | null | undefined): ExerciseMatch | null => {
  const normalizedInput = normalizeText(rawExercise || '');
  if (!normalizedInput) return null;

  for (const group of EXERCISE_LIBRARY) {
    for (const alias of group.aliases) {
      const normalizedAlias = normalizeText(alias);
      if (normalizedInput === normalizedAlias || normalizedInput.includes(normalizedAlias) || normalizedAlias.includes(normalizedInput)) {
        return {
          canonical: group.canonical,
          confidence: 'high',
          matchedFrom: alias,
        };
      }
    }
  }

  let best: { canonical: string; alias: string; distance: number } | null = null;

  for (const group of EXERCISE_LIBRARY) {
    for (const alias of group.aliases) {
      const distance = levenshtein(normalizedInput, normalizeText(alias));
      if (!best || distance < best.distance) {
        best = { canonical: group.canonical, alias, distance };
      }
    }
  }

  if (!best) return null;

  const normalizedLength = Math.max(normalizedInput.length, normalizeText(best.alias).length, 1);
  const ratio = best.distance / normalizedLength;

  if (ratio <= 0.2) {
    return {
      canonical: best.canonical,
      confidence: ratio <= 0.1 ? 'high' : 'medium',
      matchedFrom: best.alias,
    };
  }

  return null;
};
