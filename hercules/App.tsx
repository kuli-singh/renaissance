import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { HerculesActionButton } from './ui/components/HerculesActionButton';
import { findClosestExercise, getExerciseCatalog } from './lib/exercise-catalog';
import { herculesTheme } from './ui/theme';
import { getExerciseGuidance } from './lib/exercise-guidance';
import { ParsedWorkoutLog, parseWorkoutLog, transcribeAudio } from './lib/openai';
import { deleteWorkout, fetchRecentWorkouts, insertWorkout, logClientError, WorkoutRecord } from './lib/supabase';

type HerculesTab = 'capture' | 'logbook';
type ExercisePickerMode = 'replace' | 'next';

const BUILD_LABEL = 'hercules-b3';

interface ExerciseSetDraft {
  id: string;
  setNumber: number;
  reps: string;
  weight: string;
  notes: string;
}

interface ExerciseBlockDraft {
  exercise: string;
  transcript: string;
  weightUnit: 'lb' | 'kg' | null;
  rows: ExerciseSetDraft[];
  assumptionNote?: string | null;
}

const createDefaultRows = (count = 3): ExerciseSetDraft[] => (
  Array.from({ length: count }, (_, index) => ({
    id: `set-${index + 1}`,
    setNumber: index + 1,
    reps: '',
    weight: '',
    notes: '',
  }))
);

const normalizeExercise = (value: string) => value.trim().toLowerCase();

const formatCreatedAt = (value: string) => {
  const date = new Date(value);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatDayLabel = (value: string) => {
  const date = new Date(value);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatToday = () => (
  new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
);

const groupWorkoutsByDay = (workouts: WorkoutRecord[]) => {
  const groups = new Map<string, WorkoutRecord[]>();

  workouts.forEach((workout) => {
    const dayKey = workout.created_at.split('T')[0];
    const current = groups.get(dayKey) || [];
    current.push(workout);
    groups.set(dayKey, current);
  });

  return Array.from(groups.entries()).map(([date, items]) => ({
    date,
    items,
  }));
};

const getWorkoutTimestamp = (workout: WorkoutRecord) => new Date(workout.created_at).getTime();

const groupDayItemsIntoExerciseCards = (items: WorkoutRecord[]) => {
  const cards: { id: string; exercise: string; items: WorkoutRecord[] }[] = [];

  items.forEach((item) => {
    const lastCard = cards[cards.length - 1];
    const canAppend = !!lastCard
      && lastCard.exercise === item.exercise
      && Math.abs(getWorkoutTimestamp(lastCard.items[0]) - getWorkoutTimestamp(item)) <= 10 * 60 * 1000;

    if (canAppend) {
      lastCard.items.push(item);
      return;
    }

    cards.push({
      id: `${item.exercise}-${item.id}`,
      exercise: item.exercise,
      items: [item],
    });
  });

  return cards;
};

const parseNumericInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatWorkoutNote = (value: string | null | undefined) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  const withoutUnitTag = trimmed.replace(/\s*\[(kg|lb)\]\s*$/i, '').trim();
  return /^\[(kg|lb)\]$/i.test(trimmed) ? '' : withoutUnitTag;
};

const nextRowIndex = (rows: ExerciseSetDraft[]) => {
  const firstBlank = rows.findIndex((row) => !row.reps && !row.weight && !row.notes);
  return firstBlank >= 0 ? firstBlank : rows.length;
};

const buildRowsForParsedSet = (
  existingRows: ExerciseSetDraft[] | null,
  parsed: ParsedWorkoutLog,
  inferredSetNumber: number | null
) => {
  const targetSetNumber = parsed.set || inferredSetNumber;
  const requiredCount = Math.max(3, targetSetNumber || 0, existingRows?.length || 0);
  const baseRows = existingRows
    ? existingRows.map((row) => ({ ...row }))
    : createDefaultRows(requiredCount);

  while (baseRows.length < requiredCount) {
    baseRows.push({
      id: `set-${baseRows.length + 1}`,
      setNumber: baseRows.length + 1,
      reps: '',
      weight: '',
      notes: '',
    });
  }

  const targetIndex = targetSetNumber ? Math.max(0, targetSetNumber - 1) : nextRowIndex(baseRows);
  if (!baseRows[targetIndex]) {
    baseRows[targetIndex] = {
      id: `set-${targetIndex + 1}`,
      setNumber: targetIndex + 1,
      reps: '',
      weight: '',
      notes: '',
    };
  }

  const targetRow = baseRows[targetIndex];
  baseRows[targetIndex] = {
    ...targetRow,
    setNumber: targetSetNumber || targetRow.setNumber,
    reps: parsed.reps != null ? String(parsed.reps) : targetRow.reps,
    weight: parsed.weight != null ? String(parsed.weight) : targetRow.weight,
    notes: parsed.notes || targetRow.notes,
  };

  return baseRows;
};

const findNextAvailableSetNumber = (rows: ExerciseSetDraft[]) => {
  const nextIndex = nextRowIndex(rows);
  return nextIndex + 1;
};

const getHintText = (isRecording: boolean, isProcessing: boolean, statusText: string) => {
  if (isRecording) return 'Release to parse the set';
  if (isProcessing) return statusText;
  return statusText;
};

export default function App() {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const haloAnim = useRef(new Animated.Value(0.22)).current;
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [activeTab, setActiveTab] = useState<HerculesTab>('capture');
  const [statusText, setStatusText] = useState('Hold to log a set');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutRecord[]>([]);
  const [currentBlock, setCurrentBlock] = useState<ExerciseBlockDraft | null>(null);
  const [blockDirty, setBlockDirty] = useState(false);
  const [exercisePickerVisible, setExercisePickerVisible] = useState(false);
  const [exercisePickerMode, setExercisePickerMode] = useState<ExercisePickerMode>('replace');
  const [deletingWorkoutId, setDeletingWorkoutId] = useState<string | null>(null);
  const [expandedNoteIds, setExpandedNoteIds] = useState<string[]>([]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 950,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 950,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(haloAnim, {
            toValue: 0.52,
            duration: 950,
            useNativeDriver: true,
          }),
          Animated.timing(haloAnim, {
            toValue: 0.14,
            duration: 950,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [haloAnim, pulseAnim]);

  useEffect(() => {
    Audio.requestPermissionsAsync().catch((error) => {
      console.error('Failed to request audio permissions', error);
    });
  }, []);

  const refreshWorkouts = async () => {
    const rows = await fetchRecentWorkouts();
    setRecentWorkouts(rows);
  };

  useEffect(() => {
    refreshWorkouts().catch((error) => {
      console.error('Failed to load workouts', error);
    });
  }, []);

  const startRecording = async () => {
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    recordingRef.current = recording;
  };

  const stopRecording = async (): Promise<string | null> => {
    if (!recordingRef.current) return null;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      return uri;
    } catch (error) {
      console.error('Failed to stop recording', error);
      return null;
    }
  };

  const handlePressIn = async () => {
    if (isRecording || isProcessing) return;

    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsRecording(true);
      setStatusText('Listening...');
      await startRecording();
    } catch (error) {
      setIsRecording(false);
      setStatusText('Mic failed. Try again.');
      console.error('Failed to start recording', error);
    }
  };

  const mergeParsedIntoBlock = (parsed: ParsedWorkoutLog, transcript: string) => {
    setCurrentBlock((current) => {
      const normalizedSpokenExercise = parsed.exercise?.trim() || null;
      const matchedExercise = findClosestExercise(normalizedSpokenExercise);
      const resolvedExercise = matchedExercise?.item.label || normalizedSpokenExercise || current?.exercise || null;
      const isSameExercise = !!(current && resolvedExercise && normalizeExercise(current.exercise) === normalizeExercise(resolvedExercise));
      const inferredSetNumber = !parsed.set && current && isSameExercise
        ? findNextAvailableSetNumber(current.rows)
        : null;
      const rows = buildRowsForParsedSet(isSameExercise ? current.rows : null, parsed, inferredSetNumber);

      const assumptionBits: string[] = [];
      if (!normalizedSpokenExercise && current?.exercise) {
        assumptionBits.push(`Assumed exercise: ${current.exercise}`);
      } else if (matchedExercise && normalizedSpokenExercise && normalizeExercise(matchedExercise.item.label) !== normalizeExercise(normalizedSpokenExercise)) {
        assumptionBits.push(`Mapped "${normalizedSpokenExercise}" to ${matchedExercise.item.label}`);
      }
      if (!parsed.set && inferredSetNumber) {
        assumptionBits.push(`Assumed set ${inferredSetNumber}`);
      }

      return {
        exercise: resolvedExercise || current?.exercise || 'Unknown Exercise',
        transcript,
        weightUnit: parsed.weightUnit || current?.weightUnit || null,
        rows,
        assumptionNote: assumptionBits.length > 0 ? assumptionBits.join(' • ') : null,
      };
    });
    setBlockDirty(true);
  };

  const beginExercisePicker = (mode: ExercisePickerMode) => {
    setExercisePickerMode(mode);
    setExercisePickerVisible(true);
  };

  const handleSelectExercise = (exerciseLabel: string) => {
    setExercisePickerVisible(false);

    if (exercisePickerMode === 'next') {
      setCurrentBlock({
        exercise: exerciseLabel,
        transcript: '',
        weightUnit: currentBlock?.weightUnit || null,
        rows: createDefaultRows(3),
        assumptionNote: null,
      });
      setBlockDirty(false);
      setStatusText(`Started ${exerciseLabel}`);
      return;
    }

    setCurrentBlock((current) => {
      if (!current) {
        return {
          exercise: exerciseLabel,
          transcript: '',
          weightUnit: null,
          rows: createDefaultRows(3),
          assumptionNote: null,
        };
      }

      return {
        ...current,
        exercise: exerciseLabel,
        assumptionNote: null,
      };
    });
    setBlockDirty(true);
  };

  const handlePressOut = async () => {
    if (!isRecording || isProcessing) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsRecording(false);
    setIsProcessing(true);

    let captureStage = 'stop_recording';
    let transcriptionPreview: string | null = null;

    try {
      setStatusText('Transcribing...');
      const audioUri = await stopRecording();

      if (!audioUri) {
        throw new Error('No audio recorded');
      }

      captureStage = 'transcribe_audio';
      const transcription = await transcribeAudio(audioUri);
      transcriptionPreview = transcription.slice(0, 240);
      setLastTranscript(transcription);

      captureStage = 'parse_workout';
      setStatusText('Building set table...');
      const parsed = await parseWorkoutLog(transcription);
      mergeParsedIntoBlock(parsed, transcription);

      const spokenExercise = parsed.exercise || currentBlock?.exercise || 'exercise';
      setStatusText(`Captured ${spokenExercise}`);
      setTimeout(() => setStatusText('Hold to log the next set'), 1600);
    } catch (error) {
      console.error('Workout processing error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await logClientError({
        feature: 'workout_capture',
        stage: captureStage,
        message: errorMessage,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorStack: error instanceof Error ? error.stack || null : null,
        context: {
          transcriptionPreview,
          currentBlock,
        },
      });

      setStatusText(
        errorMessage.includes('insufficient_quota')
          ? 'OpenAI quota hit. Top up API billing.'
          : 'Capture failed. Try again.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshWorkouts();
    } finally {
      setIsRefreshing(false);
    }
  };

  const updateRow = (rowId: string, field: keyof ExerciseSetDraft, value: string | number) => {
    setCurrentBlock((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) => (
          row.id === rowId
            ? {
                ...row,
                [field]: value,
              }
            : row
        )),
      };
    });
    setBlockDirty(true);
  };

  const saveCurrentBlock = async () => {
    if (!currentBlock || isProcessing) return;

    const rowsToSave = currentBlock.rows.filter((row) => row.reps || row.weight || row.notes);
    if (rowsToSave.length === 0) {
      setStatusText('Fill at least one row first.');
      return;
    }

    setIsProcessing(true);
    try {
      for (const row of rowsToSave) {
        await insertWorkout({
          exercise: currentBlock.exercise,
          set: row.setNumber,
          reps: parseNumericInput(row.reps),
          weight: parseNumericInput(row.weight),
          notes: row.notes.trim(),
        });
      }

      await refreshWorkouts();
      setBlockDirty(false);
      setStatusText(`Saved ${currentBlock.exercise} to logbook`);
      setActiveTab('logbook');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setStatusText('Save failed.');
      await logClientError({
        feature: 'workout_capture',
        stage: 'save_exercise_block',
        message: errorMessage,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorStack: error instanceof Error ? error.stack || null : null,
        context: {
          exercise: currentBlock.exercise,
          rows: currentBlock.rows,
        },
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteWorkout = async (item: WorkoutRecord) => {
    if (deletingWorkoutId || isProcessing) return;

    setDeletingWorkoutId(item.id);
    try {
      await deleteWorkout(item.id);
      await refreshWorkouts();
      setStatusText(`Removed ${item.exercise} set ${item.set ?? ''}`.trim());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setStatusText('Delete failed.');
      await logClientError({
        feature: 'workout_capture',
        stage: 'delete_logbook_row',
        message: errorMessage,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorStack: error instanceof Error ? error.stack || null : null,
        context: {
          workoutId: item.id,
          exercise: item.exercise,
        },
      });
    } finally {
      setDeletingWorkoutId(null);
    }
  };

  const toggleExpandedNote = (id: string) => {
    setExpandedNoteIds((current) => (
      current.includes(id)
        ? current.filter((itemId) => itemId !== id)
        : [...current, id]
    ));
  };

  const groupedWorkouts = groupWorkoutsByDay(recentWorkouts);
  const exerciseGuidance = getExerciseGuidance(currentBlock?.exercise);
  const updateIdShort = (Updates.updateId || 'embedded').slice(0, 8);
  const channel = Updates.channel || 'unknown';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={herculesTheme.colors.accent}
          />
        }
      >
        <View style={styles.heroPanel}>
          <Text style={styles.header}>Hercules</Text>
          <Text style={styles.today}>{formatToday()}</Text>
          <Text style={styles.title}>Lift. Speak. Fill the block. Save the day.</Text>
          <Text style={styles.versionBadge}>build:{BUILD_LABEL} · ch:{channel} · upd:{updateIdShort}</Text>
          <Text style={styles.subtitle}>
            Say one set at a time: “Lat pulldown, set 1, 12 reps, 30 kilos.”
          </Text>
        </View>

        <View style={styles.tabRow}>
          <Pressable
            onPress={() => setActiveTab('capture')}
            style={[styles.tabButton, activeTab === 'capture' && styles.tabButtonActive]}
          >
            <Text style={[styles.tabLabel, activeTab === 'capture' && styles.tabLabelActive]}>Capture</Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('logbook')}
            style={[styles.tabButton, activeTab === 'logbook' && styles.tabButtonActive]}
          >
            <Text style={[styles.tabLabel, activeTab === 'logbook' && styles.tabLabelActive]}>Logbook</Text>
          </Pressable>
        </View>

        {activeTab === 'capture' ? (
          <>
            <View style={styles.quickActionRow}>
              <Pressable style={styles.secondaryButton} onPress={() => beginExercisePicker('next')}>
                <Text style={styles.secondaryButtonText}>Next Exercise</Text>
              </Pressable>
            </View>

            <View style={styles.actionWrap}>
              <HerculesActionButton
                label={isRecording ? 'Listening' : isProcessing ? 'Working' : 'Log Set'}
                hint={getHintText(isRecording, isProcessing, statusText)}
                pulseAnim={pulseAnim}
                haloAnim={haloAnim}
                isRecording={isRecording}
                isProcessing={isProcessing}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
              />
            </View>

            <View style={styles.captureStatusWrap}>
              <Text style={styles.captureActionLabel}>Log Set</Text>
              <Text style={styles.captureStatusText}>
                {isRecording ? 'Release to process' : statusText}
              </Text>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardLabel}>Current Exercise</Text>
                {currentBlock?.weightUnit ? (
                  <Text style={styles.unitPill}>{currentBlock.weightUnit.toUpperCase()}</Text>
                ) : null}
              </View>

              {currentBlock ? (
                <>
                  <Pressable onPress={() => beginExercisePicker('replace')} style={styles.exercisePickerField}>
                    <Text style={styles.exerciseInput}>{currentBlock.exercise}</Text>
                    <Text style={styles.exercisePickerHint}>Tap to change exercise</Text>
                  </Pressable>

                  {currentBlock.assumptionNote ? (
                    <Text style={styles.assumptionText}>{currentBlock.assumptionNote}</Text>
                  ) : null}

                  <View style={styles.blockTableHeader}>
                    <Text style={[styles.tableHeaderText, styles.setColumn]}>Set</Text>
                    <Text style={[styles.tableHeaderText, styles.metricColumn]}>Reps</Text>
                    <Text style={[styles.tableHeaderText, styles.metricColumn]}>Weight</Text>
                    <Text style={[styles.tableHeaderText, styles.noteColumn]}>Notes</Text>
                  </View>

                  {currentBlock.rows.map((row) => (
                    <View key={row.id} style={styles.blockRow}>
                      <Text style={[styles.setValue, styles.setColumn]}>{row.setNumber}</Text>
                      <TextInput
                        style={[styles.tableInput, styles.metricColumn]}
                        value={row.reps}
                        onChangeText={(reps) => updateRow(row.id, 'reps', reps)}
                        keyboardType="numeric"
                        placeholder="-"
                        placeholderTextColor={herculesTheme.colors.textDim}
                      />
                      <TextInput
                        style={[styles.tableInput, styles.metricColumn]}
                        value={row.weight}
                        onChangeText={(weight) => updateRow(row.id, 'weight', weight)}
                        keyboardType="numeric"
                        placeholder="-"
                        placeholderTextColor={herculesTheme.colors.textDim}
                      />
                      <TextInput
                        style={[styles.tableInput, styles.noteColumn]}
                        value={row.notes}
                        onChangeText={(notes) => updateRow(row.id, 'notes', notes)}
                        placeholder="Notes"
                        placeholderTextColor={herculesTheme.colors.textDim}
                      />
                    </View>
                  ))}

                  {exerciseGuidance ? (
                    <View style={styles.guidanceCard}>
                      <View style={styles.guidanceHeader}>
                        <Text style={styles.cardLabel}>Suggested Tempo</Text>
                        <Text style={styles.guidanceTitle}>{exerciseGuidance.label}</Text>
                      </View>
                      <View style={styles.guidancePillRow}>
                        <View style={styles.guidancePill}>
                          <Text style={styles.guidancePillLabel}>Eccentric</Text>
                          <Text style={styles.guidancePillValue}>{exerciseGuidance.eccentricSeconds}s</Text>
                        </View>
                        <View style={styles.guidancePill}>
                          <Text style={styles.guidancePillLabel}>Pause</Text>
                          <Text style={styles.guidancePillValue}>{exerciseGuidance.pauseSeconds}s</Text>
                        </View>
                        <View style={styles.guidancePill}>
                          <Text style={styles.guidancePillLabel}>Up</Text>
                          <Text style={styles.guidancePillValue}>{exerciseGuidance.concentricSeconds}s</Text>
                        </View>
                        <View style={styles.guidancePill}>
                          <Text style={styles.guidancePillLabel}>Rest</Text>
                          <Text style={styles.guidancePillValue}>{exerciseGuidance.restSeconds}s</Text>
                        </View>
                      </View>
                      <Text style={styles.guidanceCue}>{exerciseGuidance.cue}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    onPress={saveCurrentBlock}
                    disabled={!blockDirty || isProcessing}
                    style={[
                      styles.saveButton,
                      (!blockDirty || isProcessing) && styles.saveButtonDisabled,
                    ]}
                  >
                    <Text style={styles.saveButtonText}>Save Exercise to Logbook</Text>
                  </Pressable>

                  <Text style={styles.cardDetail}>
                    {lastTranscript ? `Last heard: ${lastTranscript}` : 'Your most recent transcript will show here.'}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>No exercise block yet</Text>
                  <Text style={styles.cardDetail}>
                    Hold the button and say one set cleanly. A 3-set block will appear automatically for that exercise.
                  </Text>
                </>
              )}
            </View>

            <View style={styles.coachCard}>
              <Text style={styles.cardLabel}>How To Use It</Text>
              <Text style={styles.coachText}>Start a new movement by saying the exercise, set number, reps, and weight.</Text>
              <Text style={styles.coachText}>Keep speaking one set at a time. New captures for the same exercise will fill the block.</Text>
              <Text style={styles.coachText}>When the exercise block looks right, save it and move to the logbook tab.</Text>
            </View>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Daily Logbook</Text>
            {groupedWorkouts.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No logged rows yet</Text>
                <Text style={styles.cardDetail}>
                  Save an exercise block from the capture tab and it will appear here grouped by day.
                </Text>
              </View>
            ) : (
              groupedWorkouts.map((group) => (
                <View key={group.date} style={styles.daySection}>
                  <Text style={styles.dayTitle}>{formatDayLabel(group.date)}</Text>
                  <Text style={styles.daySubtitle}>{group.date}</Text>
                  {groupDayItemsIntoExerciseCards(group.items).map((card) => (
                    <View key={card.id} style={styles.exerciseLogCard}>
                      <Text style={styles.exerciseLogTitle}>{card.exercise}</Text>
                      <View style={styles.logHeader}>
                        <Text style={[styles.tableHeaderText, styles.logSetColumn]}>Set</Text>
                        <Text style={[styles.tableHeaderText, styles.logMetricColumn]}>Reps</Text>
                        <Text style={[styles.tableHeaderText, styles.logMetricColumn]}>Weight</Text>
                        <Text style={[styles.tableHeaderText, styles.logTimeColumn]}>Time</Text>
                        <Text style={[styles.tableHeaderText, styles.logNotesColumn]}>Note</Text>
                      </View>

                      {card.items.map((item) => (
                        <View key={item.id} style={styles.logEntry}>
                          <View style={styles.logRow}>
                            <Text style={[styles.logCell, styles.logSetColumn]}>{item.set ?? '-'}</Text>
                            <Text style={[styles.logCell, styles.logMetricColumn]}>{item.reps ?? '-'}</Text>
                            <Text style={[styles.logCell, styles.logMetricColumn]}>{item.weight ?? '-'}</Text>
                            <Text style={[styles.logTime, styles.logTimeColumn]}>{formatCreatedAt(item.created_at)}</Text>
                            {formatWorkoutNote(item.notes) ? (
                              <Pressable onPress={() => toggleExpandedNote(item.id)} style={styles.noteToggle}>
                                <Text style={styles.noteToggleText}>
                                  {expandedNoteIds.includes(item.id) ? 'Hide' : 'Show'}
                                </Text>
                              </Pressable>
                            ) : (
                              <View style={styles.noteTogglePlaceholder} />
                            )}
                          </View>
                          {formatWorkoutNote(item.notes) && expandedNoteIds.includes(item.id) ? (
                            <View style={styles.notePanel}>
                              <Text style={styles.logNote}>{formatWorkoutNote(item.notes)}</Text>
                              <Pressable
                                onPress={() => handleDeleteWorkout(item)}
                                disabled={deletingWorkoutId === item.id}
                                style={[
                                  styles.inlineDeleteButton,
                                  deletingWorkoutId === item.id && styles.deleteLogButtonDisabled,
                                ]}
                              >
                                <Text style={styles.deleteLogButtonText}>
                                  {deletingWorkoutId === item.id ? 'Removing...' : 'Remove row'}
                                </Text>
                              </Pressable>
                            </View>
                          ) : (
                            <Pressable
                              onPress={() => handleDeleteWorkout(item)}
                              disabled={deletingWorkoutId === item.id}
                              style={[
                                styles.compactDeleteButton,
                                deletingWorkoutId === item.id && styles.deleteLogButtonDisabled,
                              ]}
                            >
                              <Text style={styles.deleteLogButtonText}>
                                {deletingWorkoutId === item.id ? '...' : 'Remove'}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {exercisePickerVisible ? (
        <View style={styles.overlayWrap} pointerEvents="box-none">
          <Pressable style={styles.modalBackdrop} onPress={() => setExercisePickerVisible(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalCard}>
              <View style={styles.modalGrabber} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {exercisePickerMode === 'next' ? 'Select Next Exercise' : 'Change Exercise'}
                </Text>
                <Pressable onPress={() => setExercisePickerVisible(false)}>
                  <Text style={styles.modalClose}>Close</Text>
                </Pressable>
              </View>

              <ScrollView
                style={styles.modalList}
                contentContainerStyle={styles.modalListContent}
                showsVerticalScrollIndicator={false}
              >
                {getExerciseCatalog().map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => handleSelectExercise(item.label)}
                    style={styles.modalRow}
                  >
                    <Text style={styles.modalRowTitle}>{item.label}</Text>
                    <Text style={styles.modalRowMeta}>
                      {item.bodyPart.replace('_', ' ')} • {item.defaultTempo.eccentric}-{item.defaultTempo.pause}-{item.defaultTempo.concentric}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: herculesTheme.colors.background,
  },
  content: {
    padding: herculesTheme.spacing.lg,
    paddingBottom: herculesTheme.spacing.xl * 1.5,
    gap: herculesTheme.spacing.lg,
  },
  heroPanel: {
    paddingTop: herculesTheme.spacing.xl,
    gap: herculesTheme.spacing.xs,
    alignItems: 'center',
  },
  header: {
    color: herculesTheme.colors.accent,
    fontSize: 28,
    fontWeight: '300',
    letterSpacing: 4,
  },
  today: {
    color: herculesTheme.colors.textDim,
    fontSize: herculesTheme.typography.label,
    fontWeight: '700',
  },
  title: {
    color: herculesTheme.colors.text,
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: 1.2,
    lineHeight: 30,
    textAlign: 'center',
    maxWidth: 360,
  },
  versionBadge: {
    color: herculesTheme.colors.textDim,
    fontSize: 11,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  subtitle: {
    color: herculesTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 340,
    textAlign: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    gap: herculesTheme.spacing.sm,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: herculesTheme.colors.panelMuted,
    borderRadius: herculesTheme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.08)',
    paddingVertical: 11,
  },
  tabButtonActive: {
    backgroundColor: 'rgba(125, 255, 207, 0.12)',
    borderColor: 'rgba(125, 255, 207, 0.28)',
  },
  tabLabel: {
    color: herculesTheme.colors.textMuted,
    fontSize: herculesTheme.typography.label,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tabLabelActive: {
    color: herculesTheme.colors.accent,
  },
  quickActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  secondaryButton: {
    backgroundColor: herculesTheme.colors.panelMuted,
    borderRadius: herculesTheme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.14)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: herculesTheme.colors.accent,
    fontSize: herculesTheme.typography.label,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  actionWrap: {
    alignItems: 'center',
    paddingTop: herculesTheme.spacing.sm,
    paddingBottom: herculesTheme.spacing.xs,
  },
  captureStatusWrap: {
    alignItems: 'center',
    gap: 4,
    marginTop: -2,
    marginBottom: herculesTheme.spacing.sm,
  },
  captureActionLabel: {
    color: herculesTheme.colors.accent,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  captureStatusText: {
    color: herculesTheme.colors.textMuted,
    fontSize: herculesTheme.typography.body,
    fontWeight: '500',
    textAlign: 'center',
  },
  card: {
    backgroundColor: 'rgba(13, 27, 24, 0.92)',
    borderRadius: herculesTheme.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.12)',
    padding: herculesTheme.spacing.md,
    gap: herculesTheme.spacing.sm,
  },
  coachCard: {
    backgroundColor: 'rgba(11, 23, 21, 0.88)',
    borderRadius: herculesTheme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.08)',
    padding: herculesTheme.spacing.md,
    gap: herculesTheme.spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLabel: {
    color: herculesTheme.colors.textDim,
    fontSize: herculesTheme.typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  unitPill: {
    color: herculesTheme.colors.accent,
    fontSize: herculesTheme.typography.label,
    fontWeight: '800',
    backgroundColor: 'rgba(125, 255, 207, 0.10)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: herculesTheme.radius.pill,
    overflow: 'hidden',
  },
  exerciseInput: {
    color: herculesTheme.colors.text,
    fontSize: 28,
    fontWeight: '800',
    paddingTop: 6,
  },
  exercisePickerField: {
    paddingBottom: 6,
  },
  exercisePickerHint: {
    color: herculesTheme.colors.textDim,
    fontSize: herculesTheme.typography.label,
    fontWeight: '700',
  },
  assumptionText: {
    color: herculesTheme.colors.timer,
    fontSize: herculesTheme.typography.label,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: -2,
  },
  blockTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(125, 255, 207, 0.12)',
    paddingBottom: 8,
    paddingTop: 4,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: herculesTheme.spacing.xs,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(125, 255, 207, 0.05)',
  },
  setColumn: {
    width: 42,
    textAlign: 'center',
  },
  metricColumn: {
    width: 60,
  },
  noteColumn: {
    flex: 1,
  },
  tableHeaderText: {
    color: herculesTheme.colors.textDim,
    fontSize: herculesTheme.typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  setValue: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.body,
    fontWeight: '800',
  },
  tableInput: {
    color: herculesTheme.colors.text,
    backgroundColor: 'rgba(6, 17, 15, 0.75)',
    borderRadius: herculesTheme.radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: herculesTheme.typography.body,
  },
  guidanceCard: {
    gap: herculesTheme.spacing.sm,
    backgroundColor: 'rgba(6, 17, 15, 0.68)',
    borderRadius: herculesTheme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.08)',
    marginTop: herculesTheme.spacing.sm,
    padding: herculesTheme.spacing.md,
  },
  guidanceHeader: {
    gap: 2,
  },
  guidanceTitle: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.body,
    fontWeight: '800',
  },
  guidancePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: herculesTheme.spacing.sm,
  },
  guidancePill: {
    backgroundColor: herculesTheme.colors.panelMuted,
    borderRadius: herculesTheme.radius.pill,
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guidancePillLabel: {
    color: herculesTheme.colors.textDim,
    fontSize: herculesTheme.typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  guidancePillValue: {
    color: herculesTheme.colors.accent,
    fontSize: herculesTheme.typography.body,
    fontWeight: '800',
    marginTop: 3,
  },
  guidanceCue: {
    color: herculesTheme.colors.textMuted,
    fontSize: herculesTheme.typography.label,
    lineHeight: 19,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: herculesTheme.colors.accentStrong,
    borderRadius: herculesTheme.radius.pill,
    marginTop: herculesTheme.spacing.sm,
    paddingVertical: 14,
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonText: {
    color: '#032720',
    fontSize: herculesTheme.typography.body,
    fontWeight: '800',
  },
  cardDetail: {
    color: herculesTheme.colors.textMuted,
    fontSize: herculesTheme.typography.label,
    lineHeight: 20,
  },
  emptyTitle: {
    color: herculesTheme.colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  coachText: {
    color: herculesTheme.colors.textMuted,
    fontSize: herculesTheme.typography.body,
    lineHeight: 21,
  },
  emptyCard: {
    gap: herculesTheme.spacing.xs,
    paddingVertical: herculesTheme.spacing.sm,
  },
  daySection: {
    gap: herculesTheme.spacing.sm,
    paddingTop: herculesTheme.spacing.sm,
  },
  dayTitle: {
    color: herculesTheme.colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  daySubtitle: {
    color: herculesTheme.colors.textDim,
    fontSize: herculesTheme.typography.label,
    fontWeight: '700',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: herculesTheme.colors.border,
    paddingBottom: 8,
  },
  exerciseLogCard: {
    backgroundColor: 'rgba(6, 17, 15, 0.74)',
    borderRadius: herculesTheme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.08)',
    padding: herculesTheme.spacing.md,
    gap: herculesTheme.spacing.sm,
  },
  exerciseLogTitle: {
    color: herculesTheme.colors.text,
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 22,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(159, 193, 182, 0.08)',
    paddingVertical: 10,
    gap: herculesTheme.spacing.xs,
  },
  logEntry: {
    gap: herculesTheme.spacing.xs,
  },
  logSetColumn: {
    width: 42,
    textAlign: 'center',
  },
  logMetricColumn: {
    width: 62,
    textAlign: 'center',
  },
  logTimeColumn: {
    width: 66,
    textAlign: 'right',
  },
  logNotesColumn: {
    width: 54,
    textAlign: 'center',
  },
  logCell: {
    color: herculesTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  logTime: {
    color: herculesTheme.colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  noteToggle: {
    width: 54,
    alignItems: 'center',
    backgroundColor: 'rgba(125, 255, 207, 0.08)',
    borderRadius: herculesTheme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.14)',
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  noteTogglePlaceholder: {
    width: 54,
  },
  noteToggleText: {
    color: herculesTheme.colors.accent,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  notePanel: {
    backgroundColor: 'rgba(125, 255, 207, 0.06)',
    borderRadius: herculesTheme.radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.10)',
    padding: herculesTheme.spacing.sm,
    gap: herculesTheme.spacing.sm,
  },
  logNote: {
    color: herculesTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  compactDeleteButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  inlineDeleteButton: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(255, 123, 107, 0.12)',
    borderRadius: herculesTheme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 123, 107, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  deleteLogButtonDisabled: {
    opacity: 0.55,
  },
  deleteLogButtonText: {
    color: herculesTheme.colors.danger,
    fontSize: herculesTheme.typography.label,
    fontWeight: '800',
  },
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 30,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 9, 8, 0.72)',
  },
  modalSheet: {
    justifyContent: 'flex-end',
    paddingHorizontal: herculesTheme.spacing.sm,
    paddingBottom: herculesTheme.spacing.sm,
    zIndex: 31,
  },
  modalCard: {
    backgroundColor: herculesTheme.colors.backgroundElevated,
    borderTopLeftRadius: herculesTheme.radius.lg,
    borderTopRightRadius: herculesTheme.radius.lg,
    borderWidth: 1,
    borderColor: herculesTheme.colors.border,
    maxHeight: '76%',
    minHeight: 320,
    padding: herculesTheme.spacing.md,
    paddingTop: herculesTheme.spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: herculesTheme.radius.pill,
    backgroundColor: 'rgba(125, 255, 207, 0.24)',
    marginBottom: herculesTheme.spacing.sm,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: herculesTheme.spacing.sm,
  },
  modalTitle: {
    color: herculesTheme.colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  modalClose: {
    color: herculesTheme.colors.accent,
    fontSize: herculesTheme.typography.label,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  modalList: {
    flexGrow: 0,
    minHeight: 220,
  },
  modalListContent: {
    gap: herculesTheme.spacing.sm,
    paddingBottom: herculesTheme.spacing.md,
  },
  modalRow: {
    backgroundColor: herculesTheme.colors.panelMuted,
    borderRadius: herculesTheme.radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(125, 255, 207, 0.08)',
    padding: herculesTheme.spacing.md,
    gap: 4,
  },
  modalRowTitle: {
    color: herculesTheme.colors.text,
    fontSize: herculesTheme.typography.body,
    fontWeight: '800',
  },
  modalRowMeta: {
    color: herculesTheme.colors.textMuted,
    fontSize: herculesTheme.typography.label,
    textTransform: 'capitalize',
  },
});
