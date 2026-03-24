export type EffortBand = 'low' | 'medium' | 'high';

export interface SetLogDraft {
  id: string;
  movement: string;
  reps: string;
  load: string;
  effort: EffortBand;
  feeling: string;
  note: string;
  restSeconds: number;
}

export interface SessionTimerState {
  secondsRemaining: number;
  totalSeconds: number;
  label: string;
  isRunning: boolean;
}

export interface SessionObjective {
  title: string;
  blockLabel: string;
  targetSummary: string;
}

export interface SessionFeedItem {
  id: string;
  kind: 'set' | 'timer' | 'coach';
  title: string;
  detail: string;
  meta: string;
  tone?: 'default' | 'success' | 'warning';
}
