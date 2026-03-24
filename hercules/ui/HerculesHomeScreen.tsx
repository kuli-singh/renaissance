import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { HerculesActionButton } from './components/HerculesActionButton';
import { herculesTheme } from './theme';
import {
  SessionFeedItem,
  SessionObjective,
  SetLogDraft,
  SessionTimerState,
} from './types';

const initialDraft: SetLogDraft = {
  id: 'demo-set-1',
  movement: 'Front Squat',
  reps: '5',
  load: '185 lb',
  effort: 'high',
  feeling: 'Legs heavy, core solid, last rep slowed down',
  note: 'Felt stronger after widening stance by one inch.',
  restSeconds: 90,
};

const initialTimer: SessionTimerState = {
  secondsRemaining: 90,
  totalSeconds: 90,
  label: 'Rest Timer',
  isRunning: false,
};

const sessionObjective: SessionObjective = {
  title: 'Lower strength day',
  blockLabel: 'Current block',
  targetSummary: 'Front squat top work, then Romanian deadlift volume.',
};

const initialFeed: SessionFeedItem[] = [
  {
    id: 'feed-1',
    kind: 'set',
    title: 'Front Squat',
    detail: '165 lb x 5. Warm-up moved clean and fast.',
    meta: '2 min ago',
    tone: 'success',
  },
  {
    id: 'feed-2',
    kind: 'coach',
    title: 'Coach note',
    detail: 'Brace stayed solid. Keep the wider stance for working sets.',
    meta: 'Parser note',
  },
  {
    id: 'feed-3',
    kind: 'timer',
    title: 'Rest Timer',
    detail: '90-second timer was attached to the previous set.',
    meta: 'Recovered',
  },
];

const formatTimer = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

export function HerculesHomeScreen() {
  const [draft, setDraft] = useState<SetLogDraft>(initialDraft);
  const [timer, setTimer] = useState<SessionTimerState>(initialTimer);
  const [status, setStatus] = useState('Hold to explain your set');
  const [feed, setFeed] = useState<SessionFeedItem[]>(initialFeed);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  useEffect(() => {
    if (!timer.isRunning || timer.secondsRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimer((current) => {
        if (current.secondsRemaining <= 1) {
          return { ...current, secondsRemaining: 0, isRunning: false };
        }
        return { ...current, secondsRemaining: current.secondsRemaining - 1 };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timer.isRunning, timer.secondsRemaining]);

  useEffect(() => {
    if (timer.isRunning || timer.secondsRemaining > 0) return;
    setStatus('Rest complete. Record the next set when ready.');
  }, [timer.isRunning, timer.secondsRemaining]);

  const handlePressIn = () => {
    setStatus('Listening for gym-speak details');
  };

  const handlePressOut = () => {
    setStatus('Draft captured: effort, feel, and setup note');
    setTimer((current) => ({
      ...current,
      secondsRemaining: draft.restSeconds,
      totalSeconds: draft.restSeconds,
      isRunning: true,
    }));
    setFeed((current) => [
      {
        id: `feed-set-${Date.now()}`,
        kind: 'set',
        title: draft.movement,
        detail: `${draft.load} x ${draft.reps}. ${draft.feeling}`,
        meta: 'Just now',
        tone: draft.effort === 'high' ? 'warning' : 'success',
      },
      {
        id: `feed-coach-${Date.now() + 1}`,
        kind: 'coach',
        title: 'Coach note',
        detail: draft.note,
        meta: 'Generated note',
      },
      ...current,
    ]);
  };

  const quickRestPresets = [60, 90, 120];
  const progress = timer.totalSeconds === 0 ? 0 : timer.secondsRemaining / timer.totalSeconds;
  const timerStateLabel = timer.isRunning
    ? 'Running'
    : timer.secondsRemaining === 0
      ? 'Ready'
      : 'Queued';

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.heroPanel}>
        <Text style={styles.eyebrow}>Hercules</Text>
        <Text style={styles.title}>Lift. Explain. Recover. Go again.</Text>
        <Text style={styles.subtitle}>
          A strength log with the fast capture feel of Renaissance, tuned for sets, fatigue, and rest.
        </Text>
      </View>

      <View style={styles.objectiveCard}>
        <View style={styles.objectiveHeader}>
          <Text style={styles.cardLabel}>{sessionObjective.blockLabel}</Text>
          <Text style={styles.livePill}>Session Live</Text>
        </View>
        <Text style={styles.objectiveTitle}>{sessionObjective.title}</Text>
        <Text style={styles.cardDetail}>{sessionObjective.targetSummary}</Text>
      </View>

      <HerculesActionButton
        label="Explain Set"
        hint={status}
        pulseAnim={pulseAnim}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      />

      <View style={styles.grid}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Current Set</Text>
          <Text style={styles.metric}>{draft.movement}</Text>
          <Text style={styles.body}>{draft.load} x {draft.reps}</Text>
          <View style={styles.tagRow}>
            <View
              style={[
                styles.tag,
                draft.effort === 'high' && styles.tagHigh,
                draft.effort === 'medium' && styles.tagMedium,
              ]}
            >
              <Text style={styles.tagText}>Effort {draft.effort.toUpperCase()}</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>Rest {draft.restSeconds}s</Text>
            </View>
          </View>
          <Text style={styles.cardNote}>{draft.feeling}</Text>
          <Text style={styles.cardDetail}>{draft.note}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{timer.label}</Text>
          <Text style={styles.timerValue}>{formatTimer(timer.secondsRemaining)}</Text>
          <View style={styles.timerMetaRow}>
            <Text style={styles.timerState}>{timerStateLabel}</Text>
            <Text style={styles.cardDetail}>Auto-start after capture</Text>
          </View>
          <View style={styles.timerTrack}>
            <View style={[styles.timerFill, { width: `${Math.max(progress, 0.06) * 100}%` }]} />
          </View>
          <View style={styles.presetRow}>
            {quickRestPresets.map((preset) => (
              <Pressable
                key={preset}
                onPress={() =>
                  setDraft((current) => ({
                    ...current,
                    restSeconds: preset,
                  }))
                }
                style={[
                  styles.presetChip,
                  draft.restSeconds === preset && styles.presetChipActive,
                ]}
              >
                <Text style={styles.presetText}>{preset}s</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.cardDetail}>
            Timer starts automatically when a spoken set note is captured.
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Session Feed</Text>
        {feed.map((item) => (
          <View
            key={item.id}
            style={[
              styles.feedRow,
              item.tone === 'success' && styles.feedRowSuccess,
              item.tone === 'warning' && styles.feedRowWarning,
            ]}
          >
            <View style={styles.feedHeader}>
              <Text style={styles.feedTitle}>{item.title}</Text>
              <Text style={styles.feedMeta}>{item.meta}</Text>
            </View>
            <Text style={styles.cardNote}>{item.detail}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Manual Edit Surface</Text>
        <TextInput
          style={styles.input}
          value={draft.load}
          onChangeText={(load) => setDraft((current) => ({ ...current, load }))}
          placeholder="Load"
          placeholderTextColor={herculesTheme.colors.textDim}
        />
        <TextInput
          style={styles.input}
          value={draft.reps}
          onChangeText={(reps) => setDraft((current) => ({ ...current, reps }))}
          placeholder="Reps"
          placeholderTextColor={herculesTheme.colors.textDim}
        />
        <TextInput
          style={styles.input}
          value={draft.movement}
          onChangeText={(movement) => setDraft((current) => ({ ...current, movement }))}
          placeholder="Movement"
          placeholderTextColor={herculesTheme.colors.textDim}
        />
        <TextInput
          style={styles.input}
          value={draft.feeling}
          onChangeText={(feeling) => setDraft((current) => ({ ...current, feeling }))}
          placeholder="How did it feel?"
          placeholderTextColor={herculesTheme.colors.textDim}
          multiline
        />
        <TextInput
          style={styles.input}
          value={draft.note}
          onChangeText={(note) => setDraft((current) => ({ ...current, note }))}
          placeholder="Coach note"
          placeholderTextColor={herculesTheme.colors.textDim}
          multiline
        />
        <Text style={styles.cardDetail}>
          Spoken input should remain primary. Manual fields exist for cleanup and precision.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: herculesTheme.colors.background,
  },
  content: {
    padding: herculesTheme.spacing.lg,
    paddingBottom: herculesTheme.spacing.xl,
    gap: herculesTheme.spacing.lg,
  },
  heroPanel: {
    paddingTop: herculesTheme.spacing.xl,
    gap: herculesTheme.spacing.sm,
  },
  objectiveCard: {
    backgroundColor: herculesTheme.colors.backgroundElevated,
    borderRadius: herculesTheme.radius.lg,
    borderWidth: 1,
    borderColor: herculesTheme.colors.border,
    padding: herculesTheme.spacing.md,
    gap: herculesTheme.spacing.sm,
  },
  objectiveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    color: herculesTheme.colors.accent,
    fontSize: herculesTheme.typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  title: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.title,
    fontWeight: '800',
    lineHeight: 34,
  },
  subtitle: {
    color: herculesTheme.colors.textMuted,
    fontSize: herculesTheme.typography.body,
    lineHeight: 22,
  },
  livePill: {
    backgroundColor: 'rgba(125, 255, 207, 0.14)',
    borderRadius: herculesTheme.radius.pill,
    color: herculesTheme.colors.accent,
    fontSize: herculesTheme.typography.label,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  objectiveTitle: {
    color: herculesTheme.colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  grid: {
    gap: herculesTheme.spacing.md,
  },
  card: {
    backgroundColor: herculesTheme.colors.panel,
    borderWidth: 1,
    borderColor: herculesTheme.colors.border,
    borderRadius: herculesTheme.radius.md,
    padding: herculesTheme.spacing.md,
    gap: herculesTheme.spacing.sm,
  },
  cardLabel: {
    color: herculesTheme.colors.textDim,
    fontSize: herculesTheme.typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  metric: {
    color: herculesTheme.colors.text,
    fontSize: 26,
    fontWeight: '800',
  },
  body: {
    color: herculesTheme.colors.textMuted,
    fontSize: 18,
    fontWeight: '700',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: herculesTheme.spacing.sm,
  },
  tag: {
    backgroundColor: herculesTheme.colors.panelMuted,
    borderRadius: herculesTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tagHigh: {
    backgroundColor: 'rgba(255, 138, 101, 0.14)',
  },
  tagMedium: {
    backgroundColor: 'rgba(255, 209, 102, 0.14)',
  },
  tagText: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.label,
    fontWeight: '700',
  },
  cardNote: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.body,
    lineHeight: 22,
  },
  cardDetail: {
    color: herculesTheme.colors.textMuted,
    fontSize: herculesTheme.typography.label,
    lineHeight: 20,
  },
  timerValue: {
    color: herculesTheme.colors.timer,
    fontSize: herculesTheme.typography.metric,
    fontWeight: '800',
    letterSpacing: 1,
  },
  timerMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timerState: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.label,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  timerTrack: {
    width: '100%',
    height: 12,
    backgroundColor: 'rgba(138, 225, 255, 0.12)',
    borderRadius: herculesTheme.radius.pill,
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    minWidth: 18,
    backgroundColor: herculesTheme.colors.timer,
    borderRadius: herculesTheme.radius.pill,
  },
  presetRow: {
    flexDirection: 'row',
    gap: herculesTheme.spacing.sm,
  },
  presetChip: {
    backgroundColor: herculesTheme.colors.panelMuted,
    borderRadius: herculesTheme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  presetChipActive: {
    backgroundColor: 'rgba(138, 225, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(138, 225, 255, 0.36)',
  },
  presetText: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.label,
    fontWeight: '700',
  },
  feedRow: {
    backgroundColor: herculesTheme.colors.panelMuted,
    borderRadius: herculesTheme.radius.sm,
    padding: herculesTheme.spacing.md,
    gap: herculesTheme.spacing.xs,
  },
  feedRowSuccess: {
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.16)',
  },
  feedRowWarning: {
    borderWidth: 1,
    borderColor: 'rgba(255, 209, 102, 0.22)',
  },
  feedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: herculesTheme.spacing.sm,
  },
  feedTitle: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.body,
    fontWeight: '800',
    flex: 1,
  },
  feedMeta: {
    color: herculesTheme.colors.textDim,
    fontSize: herculesTheme.typography.label,
    fontWeight: '700',
  },
  input: {
    backgroundColor: herculesTheme.colors.panelMuted,
    borderRadius: herculesTheme.radius.sm,
    borderWidth: 1,
    borderColor: herculesTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.body,
  },
});
