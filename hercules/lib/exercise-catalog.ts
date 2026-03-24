import { exerciseCatalog, ExerciseCatalogItem } from '../src/config/exercise-catalog';

export interface ExerciseMatch {
  item: ExerciseCatalogItem;
  confidence: 'high' | 'medium' | 'low';
  matchedFrom: string;
}

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

export const getExerciseCatalog = () => exerciseCatalog;

export const getExerciseByLabel = (label: string | null | undefined): ExerciseCatalogItem | null => {
  const normalized = normalizeText(label || '');
  if (!normalized) return null;
  return exerciseCatalog.find((item) => normalizeText(item.label) === normalized) || null;
};

export const findClosestExercise = (rawExercise: string | null | undefined): ExerciseMatch | null => {
  const normalizedInput = normalizeText(rawExercise || '');
  if (!normalizedInput) return null;

  for (const item of exerciseCatalog) {
    for (const alias of [item.label, ...item.aliases]) {
      const normalizedAlias = normalizeText(alias);
      if (
        normalizedInput === normalizedAlias ||
        normalizedInput.includes(normalizedAlias) ||
        normalizedAlias.includes(normalizedInput)
      ) {
        return {
          item,
          confidence: 'high',
          matchedFrom: alias,
        };
      }
    }
  }

  let best: { item: ExerciseCatalogItem; alias: string; distance: number } | null = null;

  for (const item of exerciseCatalog) {
    for (const alias of [item.label, ...item.aliases]) {
      const distance = levenshtein(normalizedInput, normalizeText(alias));
      if (!best || distance < best.distance) {
        best = { item, alias, distance };
      }
    }
  }

  if (!best) return null;

  const normalizedLength = Math.max(normalizedInput.length, normalizeText(best.alias).length, 1);
  const ratio = best.distance / normalizedLength;

  if (ratio <= 0.2) {
    return {
      item: best.item,
      confidence: ratio <= 0.1 ? 'high' : 'medium',
      matchedFrom: best.alias,
    };
  }

  return null;
};
