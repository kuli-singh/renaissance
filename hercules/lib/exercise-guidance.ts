import { getExerciseByLabel } from './exercise-catalog';

export interface ExerciseGuidance {
  label: string;
  eccentricSeconds: number;
  pauseSeconds: number;
  concentricSeconds: number;
  restSeconds: number;
  cue: string;
}

const DEFAULT_REST_SECONDS = 60;

export const getExerciseGuidance = (exercise: string | null | undefined): ExerciseGuidance | null => {
  const item = getExerciseByLabel(exercise);
  if (item) {
    return {
      label: item.label,
      eccentricSeconds: item.defaultTempo.eccentric,
      pauseSeconds: item.defaultTempo.pause,
      concentricSeconds: item.defaultTempo.concentric,
      restSeconds: DEFAULT_REST_SECONDS,
      cue: item.cue,
    };
  }

  return {
    label: 'General Strength Work',
    eccentricSeconds: 3,
    pauseSeconds: 1,
    concentricSeconds: 1,
    restSeconds: DEFAULT_REST_SECONDS,
    cue: 'Control the lowering phase, own the transition, and make the working reps look repeatable.',
  };
};
