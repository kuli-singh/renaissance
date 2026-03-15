import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Animated,
  FlatList,
  RefreshControl,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { transcribeAudio, processThought, generateDailyMirror, renaissanceConfig } from './lib/openai';
import {
  Entry,
  Commitment,
  FocusRecommendation,
  fetchEntries,
  insertThought,
  getTodaysSpiritAnimal,
  fetchCommitments,
  fetchFocusRecommendations,
  createCommitment,
  updateCommitmentStatus,
  logCommitmentProgress,
  deleteEntry,
} from './lib/supabase';
import { deriveStarterStep, deriveValueInsights, TYPE_VALUE_LENS } from './lib/values';

// Fix voice-to-text name errors in display
const fixName = (text?: string | null): string => {
  if (!text) return '';
  return text.replace(/\bBooper\b/gi, 'BUPA');
};

interface AnimatedEntry extends Entry {
  glowAnim: Animated.Value;
  slideAnim: Animated.Value;
}

interface PendingCommitmentReviewItem {
  entry: AnimatedEntry;
  reasoning: string;
}

// Build dynamic mappings from config
const TYPE_COLORS: Record<string, string> = renaissanceConfig.categories.reduce(
  (acc, cat) => ({ ...acc, [cat.id]: cat.color }),
  {}
);

const TYPE_ICONS: Record<string, string> = renaissanceConfig.categories.reduce(
  (acc, cat) => ({ ...acc, [cat.id]: cat.icon }),
  {}
);

const TYPE_LABELS: Record<string, string> = renaissanceConfig.categories.reduce(
  (acc, cat) => ({ ...acc, [cat.id]: cat.label }),
  {}
);

const ENERGY_ICONS: Record<string, string> = renaissanceConfig.energyLevels.reduce(
  (acc, level) => ({ ...acc, [level.id]: level.icon }),
  {}
);

// Storage keys for persistence
const STORAGE_KEYS = {
  MORNING_MIRROR: 'renaissance_morning_mirror',
  MORNING_MIRROR_DATE: 'renaissance_morning_mirror_date', // The date the mirror was generated FOR (yesterday)
  MORNING_MIRROR_GENERATED: 'renaissance_morning_mirror_generated', // When it was generated
  NORTH_STAR: 'renaissance_north_star',
  WEEKLY_FOCUS: 'renaissance_weekly_focus',
  DAILY_ALIGNMENT: 'renaissance_daily_alignment',
  COMPASS_UPDATED_AT: 'renaissance_compass_updated_at',
  DAILY_MOVE: 'renaissance_daily_move',
  DAILY_BLOCKER: 'renaissance_daily_blocker',
  DAILY_WHEN: 'renaissance_daily_when',
  DAILY_CHECKIN_UPDATED_AT: 'renaissance_daily_checkin_updated_at',
  FOCUS_RECOMMENDATION: 'renaissance_focus_recommendation',
  FOCUS_RECOMMENDATION_DATE: 'renaissance_focus_recommendation_date',
};

// Get today's date string for comparison
const getTodayDateString = () => new Date().toISOString().split('T')[0];

// Get yesterday's date string
const getYesterdayDateString = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
};

const getDateStringFromTimestamp = (timestamp: string) => timestamp.split('T')[0];

const ENABLE_COMMITMENT_GATE = false;
const ENABLE_BOTTLENECK_BANNER = false;
const BUILD_LABEL = 'focus-b1';

// Format date for display (e.g., "February 13")
const formatDateForDisplay = (dateStr: string) => {
  const date = new Date(dateStr + 'T12:00:00'); // Add time to avoid timezone issues
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
};

const shouldGenerateMirror = (lastGeneratedDate: string | null): boolean => {
  const today = getTodayDateString();
  return lastGeneratedDate !== today;
};

const getCurrentFocusPhase = (): 'morning' | 'midday' | 'evening' => {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'midday';
  return 'evening';
};

const selectFocusRecommendationForPhase = (
  recommendations: FocusRecommendation[],
  phase: 'morning' | 'midday' | 'evening'
): FocusRecommendation | null => {
  const phaseOrder: Record<'morning' | 'midday' | 'evening', Array<'morning' | 'midday' | 'evening'>> = {
    morning: ['morning', 'midday', 'evening'],
    midday: ['midday', 'morning', 'evening'],
    evening: ['evening', 'midday', 'morning'],
  };

  for (const candidatePhase of phaseOrder[phase]) {
    const match = recommendations.find((item) => item.phase === candidatePhase);
    if (match) return match;
  }

  return recommendations[0] || null;
};

const hoursSince = (timestamp?: string | null): number => {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
};

const scoreFocusCandidate = (entry: AnimatedEntry, commitment: Commitment, weeklyFocusText: string): number => {
  let score = 0;
  const title = fixName(entry.title).toLowerCase();
  const focus = weeklyFocusText.trim().toLowerCase();
  const hoursWithoutProgress = hoursSince(commitment.last_progress_at || commitment.created_at);

  if (focus && title.includes(focus)) score += 5;
  if (entry.type === 'momentum') score += 4;
  if (entry.type === 'vitality') score += 3;
  if (entry.type === 'dream') score += 2;
  if (commitment.kind === 'ongoing') score += 1;
  if ((commitment.progress_count_7d || 0) === 0) score += 2;
  if (hoursWithoutProgress > 72) score += 4;
  else if (hoursWithoutProgress > 24) score += 2;
  if (entry.energy === 'high') score += 1;
  if (entry.energy === 'zombie') score -= 1;

  return score;
};

export default function App() {
  const [entries, setEntries] = useState<AnimatedEntry[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusText, setStatusText] = useState('Hold to record');
  const [spiritAnimal, setSpiritAnimal] = useState('🦋 Fresh Start');
  const [selectedEntry, setSelectedEntry] = useState<AnimatedEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [morningMirror, setMorningMirror] = useState<string | null>(null);
  const [mirrorSourceDate, setMirrorSourceDate] = useState<string | null>(null);
  const [isLoadingMirror, setIsLoadingMirror] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'capture' | 'focus' | 'commitments'>('capture');
  const [isMirrorCollapsed, setIsMirrorCollapsed] = useState(true);
  const [isSpiritAnimalCollapsed, setIsSpiritAnimalCollapsed] = useState(true);
  const [bottleneck, setBottleneck] = useState<string | null>(null);
  const [showBottleneckBanner, setShowBottleneckBanner] = useState(true);
  // commitmentMap: keyed by thought_id for O(1) lookups in render
  const [commitmentMap, setCommitmentMap] = useState<Record<string, Commitment>>({});
  const [gateVisible, setGateVisible] = useState(false);
  const updateIdShort = (Updates.updateId || 'embedded').slice(0, 8);
  const channel = Updates.channel || 'unknown-channel';
  const [gateCountdown, setGateCountdown] = useState(3);
  const [gateOpenCount, setGateOpenCount] = useState(0);
  const [pendingCommitmentReview, setPendingCommitmentReview] = useState<PendingCommitmentReviewItem[]>([]);
  const [commitmentReviewVisible, setCommitmentReviewVisible] = useState(false);
  const [northStar, setNorthStar] = useState('');
  const [weeklyFocus, setWeeklyFocus] = useState('');
  const [dailyAlignment, setDailyAlignment] = useState<'yes' | 'partial' | 'no' | null>(null);
  const [compassUpdatedAt, setCompassUpdatedAt] = useState<string | null>(null);
  const [dailyMove, setDailyMove] = useState('');
  const [dailyBlocker, setDailyBlocker] = useState('');
  const [dailyWhen, setDailyWhen] = useState('');
  const [dailyCheckinUpdatedAt, setDailyCheckinUpdatedAt] = useState<string | null>(null);
  const [focusRecommendation, setFocusRecommendation] = useState<FocusRecommendation | null>(null);
  const [isFocusNudgeExpanded, setIsFocusNudgeExpanded] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recordingAnim = useRef(new Animated.Value(1)).current;
  const processingAnim = useRef(new Animated.Value(1)).current;
  const recordingRef = useRef<Audio.Recording | null>(null);
  const gateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordPressLockRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const [fetchedEntries, animal, commitments] = await Promise.all([
        fetchEntries(),
        getTodaysSpiritAnimal(),
        fetchCommitments(),
      ]);

      // Build a map for fast lookups: thought_id → Commitment
      const cMap: Record<string, Commitment> = {};
      commitments.forEach(c => { cMap[c.thought_id] = c; });
      setCommitmentMap(cMap);

      const animatedEntries: AnimatedEntry[] = fetchedEntries.map((entry) => ({
        ...entry,
        glowAnim: new Animated.Value(0),
        slideAnim: new Animated.Value(1),
      }));

      setEntries(animatedEntries);
      setSpiritAnimal(animal);

      // Find the oldest momentum item as the "bottleneck" (the one being avoided)
      // Ignore noisy migration/deployment entries.
      const oldestMomentum = fetchedEntries
        .filter(e => e.type === 'momentum')
        .filter(e => !isDeploymentNoise(e.title))
        .slice(-1)[0]; // Get the oldest (last in desc order)
      if (oldestMomentum) {
        setBottleneck(oldestMomentum.title);
        setShowBottleneckBanner(true);
      } else {
        setBottleneck(null);
      }

      // Morning Mirror: daily synthesis of the full previous day's capture log
      const [storedMirror, storedSourceDate, storedGeneratedDate] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.MORNING_MIRROR),
        AsyncStorage.getItem(STORAGE_KEYS.MORNING_MIRROR_DATE),
        AsyncStorage.getItem(STORAGE_KEYS.MORNING_MIRROR_GENERATED),
      ]);

      if (shouldGenerateMirror(storedGeneratedDate)) {
        const yesterday = getYesterdayDateString();
        const yesterdaysEntries = fetchedEntries.filter(
          (entry) => getDateStringFromTimestamp(entry.created_at) === yesterday
        );

        setIsLoadingMirror(true);
        try {
          const mirror = await generateDailyMirror(
            yesterdaysEntries.map((entry) => ({
              title: entry.title,
              type: entry.type,
              energy: entry.energy,
              content: entry.content,
              insight: entry.insight,
              created_at: entry.created_at,
            }))
          );

          const today = getTodayDateString();
          await Promise.all([
            AsyncStorage.setItem(STORAGE_KEYS.MORNING_MIRROR, mirror),
            AsyncStorage.setItem(STORAGE_KEYS.MORNING_MIRROR_DATE, yesterday),
            AsyncStorage.setItem(STORAGE_KEYS.MORNING_MIRROR_GENERATED, today),
          ]);

          setMorningMirror(mirror);
          setMirrorSourceDate(yesterday);
        } finally {
          setIsLoadingMirror(false);
        }
      } else if (storedMirror && storedSourceDate) {
        setMorningMirror(storedMirror);
        setMirrorSourceDate(storedSourceDate);
      }

      const [
        storedNorthStar,
        storedWeeklyFocus,
        storedDailyAlignment,
        storedCompassUpdatedAt,
        storedDailyMove,
        storedDailyBlocker,
        storedDailyWhen,
        storedDailyCheckinUpdatedAt,
        storedFocusRecommendation,
        storedFocusRecommendationDate,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.NORTH_STAR),
        AsyncStorage.getItem(STORAGE_KEYS.WEEKLY_FOCUS),
        AsyncStorage.getItem(STORAGE_KEYS.DAILY_ALIGNMENT),
        AsyncStorage.getItem(STORAGE_KEYS.COMPASS_UPDATED_AT),
        AsyncStorage.getItem(STORAGE_KEYS.DAILY_MOVE),
        AsyncStorage.getItem(STORAGE_KEYS.DAILY_BLOCKER),
        AsyncStorage.getItem(STORAGE_KEYS.DAILY_WHEN),
        AsyncStorage.getItem(STORAGE_KEYS.DAILY_CHECKIN_UPDATED_AT),
        AsyncStorage.getItem(STORAGE_KEYS.FOCUS_RECOMMENDATION),
        AsyncStorage.getItem(STORAGE_KEYS.FOCUS_RECOMMENDATION_DATE),
      ]);
      setNorthStar(storedNorthStar || '');
      setWeeklyFocus(storedWeeklyFocus || '');
      setDailyAlignment((storedDailyAlignment as 'yes' | 'partial' | 'no' | null) || null);
      setCompassUpdatedAt(storedCompassUpdatedAt || null);
      setDailyMove(storedDailyMove || '');
      setDailyBlocker(storedDailyBlocker || '');
      setDailyWhen(storedDailyWhen || '');
      setDailyCheckinUpdatedAt(storedDailyCheckinUpdatedAt || null);

      const today = getTodayDateString();
      const currentPhase = getCurrentFocusPhase();
      const backendRecommendations = await fetchFocusRecommendations(today);
      const selectedRecommendation = selectFocusRecommendationForPhase(backendRecommendations, currentPhase);
      if (selectedRecommendation) {
        setFocusRecommendation(selectedRecommendation);
        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEYS.FOCUS_RECOMMENDATION, JSON.stringify(selectedRecommendation)),
          AsyncStorage.setItem(STORAGE_KEYS.FOCUS_RECOMMENDATION_DATE, today),
        ]);
      } else if (storedFocusRecommendation && storedFocusRecommendationDate === today) {
        try {
          setFocusRecommendation(JSON.parse(storedFocusRecommendation));
        } catch {
          setFocusRecommendation(null);
        }
      } else {
        setFocusRecommendation(null);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    (async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (check.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (_) {
        // non-critical — silently ignore
      }
    })();
  }, []);

  useEffect(() => {
    setIsFocusNudgeExpanded(false);
  }, [focusRecommendation?.id]);

  useEffect(() => {
    (async () => {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
    })();
  }, []);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  useEffect(() => {
    if (isRecording) {
      const recordPulse = Animated.loop(
        Animated.sequence([
          Animated.timing(recordingAnim, {
            toValue: 1.15,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(recordingAnim, {
            toValue: 0.95,
            duration: 200,
            useNativeDriver: true,
          }),
        ])
      );
      recordPulse.start();
      return () => recordPulse.stop();
    } else {
      recordingAnim.setValue(1);
    }
  }, [isRecording, recordingAnim]);

  useEffect(() => {
    if (isProcessing) {
      const processPulse = Animated.loop(
        Animated.sequence([
          Animated.timing(processingAnim, {
            toValue: 1.08,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(processingAnim, {
            toValue: 0.92,
            duration: 150,
            useNativeDriver: true,
          }),
        ])
      );
      processPulse.start();
      return () => processPulse.stop();
    } else {
      processingAnim.setValue(1);
    }
  }, [isProcessing, processingAnim]);

  useEffect(() => {
    return () => {
      clearGateTimer();
    };
  }, []);

  const startRecording = async () => {
    try {
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopRecording = async (): Promise<string | null> => {
    if (!recordingRef.current) return null;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      return uri;
    } catch (err) {
      console.error('Failed to stop recording', err);
      return null;
    }
  };

  const animateNewItems = (newItems: AnimatedEntry[]) => {
    newItems.forEach((item, index) => {
      setTimeout(() => {
        Animated.spring(item.slideAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }).start();

        Animated.sequence([
          Animated.timing(item.glowAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(item.glowAnim, {
            toValue: 0.3,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(item.glowAnim, {
            toValue: 0.8,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(item.glowAnim, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
        ]).start();
      }, index * 150);
    });
  };

  const clearGateTimer = () => {
    if (gateTimerRef.current) {
      clearInterval(gateTimerRef.current);
      gateTimerRef.current = null;
    }
  };

  const closeGate = () => {
    clearGateTimer();
    setGateVisible(false);
    setGateCountdown(3);
  };

  const beginRecording = async () => {
    if (recordPressLockRef.current || isRecording || isProcessing || gateVisible) {
      return;
    }

    recordPressLockRef.current = true;
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsRecording(true);
      setStatusText('Listening...');
      await startRecording();
    } finally {
      recordPressLockRef.current = false;
    }
  };

  const openCommitmentGate = (openCount: number) => {
    setGateOpenCount(openCount);
    setGateVisible(true);
    setGateCountdown(3);

    clearGateTimer();
    gateTimerRef.current = setInterval(() => {
      setGateCountdown((prev) => {
        if (prev <= 1) {
          clearGateTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRecordAnyway = async () => {
    closeGate();
    setStatusText('Hold to record');
  };

  const handlePressIn = async () => {
    if (isProcessing || gateVisible || isRecording) {
      return;
    }

    const openCommitments = Object.values(commitmentMap).filter(c => c.status === 'open').length;

    if (ENABLE_COMMITMENT_GATE && openCommitments > 3) {
      openCommitmentGate(openCommitments);
      return;
    }

    await beginRecording();
  };

  const handlePressOut = async () => {
    if (!isRecording || isProcessing) {
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsRecording(false);
    setIsProcessing(true);
    setStatusText('Transcribing...');

    try {
      const audioUri = await stopRecording();

      if (!audioUri) {
        throw new Error('No audio recorded');
      }

      // Step 1: Transcribe audio (forced English)
      const transcription = await transcribeAudio(audioUri);
      console.log('[Whisper] Transcribed:', transcription.substring(0, 100) + '...');

      setStatusText('Strategizing...');

      // Step 2: Process with Strategist + Generate Embedding (parallel)
      const processedThoughts = await processThought(transcription);
      console.log('[Strategist] Processed', processedThoughts.length, 'thoughts');

      if (processedThoughts.length === 0) {
        setStatusText('No thoughts extracted. Try again.');
        setTimeout(() => setStatusText('Hold to record'), 2000);
        setIsProcessing(false);
        return;
      }

      setStatusText('Saving...');

      const newAnimatedEntries: AnimatedEntry[] = [];
      const suggestedCommitments: PendingCommitmentReviewItem[] = [];

      // Step 3: Save each thought with embedding to Supabase
      for (const thought of processedThoughts) {
        const savedEntry = await insertThought({
          title: thought.title,
          category: thought.category,
          insight: thought.insight,
          energy: thought.energy,
          content: thought.content,
          embedding: thought.embedding,
        });

        if (savedEntry) {
          const animatedEntry: AnimatedEntry = {
            ...savedEntry,
            glowAnim: new Animated.Value(0),
            slideAnim: new Animated.Value(0),
          };
          newAnimatedEntries.push(animatedEntry);

          if (thought.suggestCommitment) {
            suggestedCommitments.push({
              entry: animatedEntry,
              reasoning: thought.commitmentReasoning || 'This sounds actionable enough to deserve accountability.',
            });
          }
        }
      }

      if (newAnimatedEntries.length > 0) {
        setEntries((prev) => [...newAnimatedEntries, ...prev]);
        animateNewItems(newAnimatedEntries);

        const newAnimal = await getTodaysSpiritAnimal();
        setSpiritAnimal(newAnimal);

        // Today's entries become part of tomorrow's mirror
      }

      if (suggestedCommitments.length > 0) {
        setPendingCommitmentReview(suggestedCommitments);
        setCommitmentReviewVisible(true);
        setStatusText(`Review ${suggestedCommitments.length} suggested commitment${suggestedCommitments.length > 1 ? 's' : ''}`);
      } else {
        setStatusText(`Added ${newAnimatedEntries.length} item${newAnimatedEntries.length > 1 ? 's' : ''}`);
        setTimeout(() => setStatusText('Hold to record'), 2000);
      }
    } catch (error) {
      console.error('Processing error:', error);
      setStatusText('Error. Try again.');
      setTimeout(() => setStatusText('Hold to record'), 2000);
    }

    setIsProcessing(false);
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const saveCompass = async () => {
    const now = new Date().toISOString();
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.NORTH_STAR, northStar.trim()),
      AsyncStorage.setItem(STORAGE_KEYS.WEEKLY_FOCUS, weeklyFocus.trim()),
      AsyncStorage.setItem(STORAGE_KEYS.DAILY_ALIGNMENT, dailyAlignment || ''),
      AsyncStorage.setItem(STORAGE_KEYS.COMPASS_UPDATED_AT, now),
    ]);
    setCompassUpdatedAt(now);
    setStatusText('Compass saved');
    setTimeout(() => setStatusText('Hold to record'), 1500);
  };

  const saveDailyCheckin = async () => {
    const now = new Date().toISOString();
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.DAILY_MOVE, dailyMove.trim()),
      AsyncStorage.setItem(STORAGE_KEYS.DAILY_BLOCKER, dailyBlocker.trim()),
      AsyncStorage.setItem(STORAGE_KEYS.DAILY_WHEN, dailyWhen.trim()),
      AsyncStorage.setItem(STORAGE_KEYS.DAILY_CHECKIN_UPDATED_AT, now),
    ]);
    setDailyCheckinUpdatedAt(now);
    setStatusText('Daily check-in saved');
    setTimeout(() => setStatusText('Hold to record'), 1500);
  };

  const isDeploymentNoise = (title?: string | null) => {
    const t = (title || '').toLowerCase().trim();
    return t.includes('app deployment success') || (t.includes('deployment') && t.includes('success'));
  };

  const visibleEntries = entries.filter(
    (entry) => !isDeploymentNoise(entry.title)
  );

  const captureCutoffDate = new Date();
  captureCutoffDate.setDate(captureCutoffDate.getDate() - 30);

  const captureEntries = visibleEntries.filter((entry) => {
    const commitment = commitmentMap[entry.id];
    const isArchivedCommitment = commitment && commitment.status !== 'open';
    if (isArchivedCommitment) return false;
    return new Date(entry.created_at) >= captureCutoffDate;
  });

  const filteredCaptureEntries = activeFilter
    ? captureEntries.filter((entry) => entry.type === activeFilter)
    : captureEntries;

  const commitmentItems = Object.entries(commitmentMap)
    .map(([thoughtId, commitment]) => {
      const entry = visibleEntries.find((e) => e.id === thoughtId);
      if (!entry) return null;
      return { entry, commitment };
    })
    .filter((item): item is { entry: AnimatedEntry; commitment: Commitment } => !!item)
    .sort((a, b) => {
      if (a.commitment.status === b.commitment.status) {
        return new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime();
      }
      if (a.commitment.status === 'open') return -1;
      if (b.commitment.status === 'open') return 1;
      return 0;
    });
  const openCommitmentItems = commitmentItems.filter((item) => item.commitment.status === 'open');
  const recentEntries = visibleEntries.filter((entry) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    return new Date(entry.created_at) >= cutoff;
  });
  const { topValues, topEmergentValue, valuesMirrorText } = deriveValueInsights(
    recentEntries,
    openCommitmentItems.map(({ entry }) => entry)
  );
  const rankedFocusItems = [...openCommitmentItems].sort((a, b) => {
    const aRecommended = focusRecommendation?.recommended_focus_thought_id === a.entry.id ? 1 : 0;
    const bRecommended = focusRecommendation?.recommended_focus_thought_id === b.entry.id ? 1 : 0;
    if (aRecommended !== bRecommended) return bRecommended - aRecommended;
    const scoreDiff = scoreFocusCandidate(b.entry, b.commitment, weeklyFocus) - scoreFocusCandidate(a.entry, a.commitment, weeklyFocus);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(a.entry.created_at).getTime() - new Date(b.entry.created_at).getTime();
  });
  const primaryFocus = rankedFocusItems[0] || null;
  const secondaryFocus = rankedFocusItems.slice(1, 3);
  const focusReason = focusRecommendation?.recommended_focus_reason?.trim() || '';
  const suggestedStarterStep = dailyMove.trim()
    || focusRecommendation?.starter_step?.trim()
    || (primaryFocus ? deriveStarterStep(primaryFocus.entry.title) : '');
  const valueLens = primaryFocus ? TYPE_VALUE_LENS[primaryFocus.entry.type] || 'what keeps recurring in your thoughts' : 'what keeps recurring in your thoughts';
  const whyThisMatters = focusReason
    || (weeklyFocus.trim()
      ? `This supports your weekly focus: ${weeklyFocus.trim()}.`
      : primaryFocus
        ? `This matters because it points at ${valueLens}, and ${topEmergentValue ? `${topEmergentValue.label.toLowerCase()} has been one of your strongest recurring values lately.` : 'that keeps showing up in your captured life.'}`
        : northStar.trim()
          ? `Use your North Star as the filter: ${northStar.trim()}.`
          : 'Use this as a test of congruence: what you think matters should get at least one concrete action.');
  const spiritAnimalReading = dailyAlignment === 'yes'
    ? `${spiritAnimal} is showing alignment right now. Something you care about is making it into lived action. Protect that pattern with one more concrete step.`
    : dailyAlignment === 'partial'
      ? `${spiritAnimal} is carrying mixed signals. Your values are visible, but they are not fully embodied yet. Shrink the gap with one move you can actually complete.`
      : openCommitmentItems.length > 5
        ? `${spiritAnimal} is warning about cognitive overload. Too many open loops are competing with each other. Keep the full map, but let only one thing lead today.`
        : `${spiritAnimal} reflects the story you are living, not just your mood. Let today’s focus prove one value in action, not just in language.`;
  const firstSpiritAnimalSpace = spiritAnimal.indexOf(' ');
  const spiritAnimalIcon = firstSpiritAnimalSpace > 0 ? spiritAnimal.slice(0, firstSpiritAnimalSpace) : '🦋';
  const spiritAnimalTitle = firstSpiritAnimalSpace > 0
    ? spiritAnimal.slice(firstSpiritAnimalSpace + 1)
    : spiritAnimal;

  const openDetail = (entry: AnimatedEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    console.log('Opening entry:', {
      id: entry.id,
      title: entry.title,
      type: entry.type,
      content: entry.content,
    });
    setSelectedEntry(entry);
    setModalVisible(true);
  };

  const closeDetail = () => {
    setModalVisible(false);
    setSelectedEntry(null);
  };

  const closeCommitmentReview = () => {
    setCommitmentReviewVisible(false);
    setPendingCommitmentReview([]);
    setStatusText('Hold to record');
  };

  const acceptSuggestedCommitment = async (item: PendingCommitmentReviewItem) => {
    if (commitmentMap[item.entry.id]) {
      setPendingCommitmentReview(prev => prev.filter(candidate => candidate.entry.id !== item.entry.id));
      return;
    }

    const created = await createCommitment(item.entry.id, item.reasoning);
    if (created) {
      setCommitmentMap(prev => ({ ...prev, [item.entry.id]: created }));
      setPendingCommitmentReview(prev => prev.filter(candidate => candidate.entry.id !== item.entry.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const dismissSuggestedCommitment = (entryId: string) => {
    setPendingCommitmentReview(prev => prev.filter(candidate => candidate.entry.id !== entryId));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleDeleteEntry = async (entry: AnimatedEntry) => {
    const ok = await deleteEntry(entry.id);
    if (ok) {
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      closeDetail();
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const renderEntry = ({ item }: { item: AnimatedEntry }) => {
    const typeColor = TYPE_COLORS[item.type] || '#00FFFF';
    const typeIcon = TYPE_ICONS[item.type] || '●';
    const commitment = commitmentMap[item.id];

    return (
      <TouchableOpacity onPress={() => openDetail(item)} activeOpacity={0.7}>
        <Animated.View
          style={[
            styles.entryItem,
            commitment?.status === 'open' && styles.entryItemOpen,
            commitment?.status === 'completed' && styles.entryItemDone,
            {
              opacity: item.slideAnim,
              transform: [
                {
                  translateX: item.slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-50, 0],
                  }),
                },
                {
                  scale: item.slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.entryGlow,
              {
                opacity: item.glowAnim,
                backgroundColor: typeColor,
              },
            ]}
          />

          <View style={[styles.entryDot, { backgroundColor: typeColor }]}>
            <Text style={styles.entryDotIcon}>{typeIcon}</Text>
          </View>
          <View style={styles.entryContent}>
            <Text style={styles.entryText}>{fixName(item.title)}</Text>
            <View style={styles.entryMeta}>
              <Text style={[styles.entryType, { color: typeColor }]}>{item.type}</Text>
              <Text style={styles.entryEnergy}>{ENERGY_ICONS[item.energy] || '●'}</Text>
              {commitment && (
                <View style={[
                  styles.commitmentBadge,
                  commitment.status === 'open' && styles.commitmentBadgeOpen,
                  commitment.status === 'completed' && styles.commitmentBadgeDone,
                  commitment.status === 'abandoned' && styles.commitmentBadgeAbandoned,
                ]}>
                  <Text style={styles.commitmentBadgeText}>
                    {commitment.status === 'open' ? '📋 OPEN' :
                     commitment.status === 'completed' ? '✅ DONE' : '🗑 DROPPED'}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <Text style={styles.entryArrow}>›</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const renderCaptureListFooter = () => (
    <View style={styles.captureListFooter}>
      <Text style={styles.captureListFooterText}>
        Showing the last 30 days in Capture. Older thoughts are still in Supabase and remain accessible.
      </Text>
    </View>
  );

  const renderCommitmentItem = ({ item }: { item: { entry: AnimatedEntry; commitment: Commitment } }) => {
    const { entry, commitment } = item;
    const typeColor = TYPE_COLORS[entry.type] || '#00FFFF';

    const statusLabel = commitment.status === 'open'
      ? 'OPEN'
      : commitment.status === 'completed'
        ? 'DONE'
        : 'DROPPED';
    const statusIcon = commitment.status === 'open'
      ? '📋'
      : commitment.status === 'completed'
        ? '✅'
        : '🗑';

    return (
      <View style={styles.commitmentListCard}>
        <View style={styles.commitmentListTopRow}>
          <TouchableOpacity onPress={() => openDetail(entry)} activeOpacity={0.7} style={styles.commitmentListTitleWrap}>
            <Text style={styles.commitmentListTitle}>{fixName(entry.title)}</Text>
          </TouchableOpacity>
          <View style={[
            styles.commitmentListStatusBadge,
            commitment.status === 'open' && styles.commitmentListStatusOpen,
            commitment.status === 'completed' && styles.commitmentListStatusDone,
            commitment.status === 'abandoned' && styles.commitmentListStatusDropped,
          ]}>
            <Text style={styles.commitmentListStatusText}>{statusIcon} {statusLabel}</Text>
          </View>
        </View>

        <TouchableOpacity onPress={() => openDetail(entry)} activeOpacity={0.7}>
          <Text style={[styles.commitmentListMeta, { color: typeColor }]}> 
            {TYPE_LABELS[entry.type] || entry.type} · {formatDate(entry.created_at)}
          </Text>
          {!!commitment.last_progress_at && (
            <Text style={styles.commitmentProgressMeta}>
              Last progress: {formatDate(commitment.last_progress_at)}
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.commitmentListActions}>
          {commitment.status === 'open' && (
            <TouchableOpacity
              style={[styles.commitmentActionPill, { borderColor: '#00B8D9' }]}
              onPress={async () => {
                const updated = await logCommitmentProgress(commitment.id, 'Quick progress check-in');
                if (updated) setCommitmentMap(prev => ({ ...prev, [entry.id]: updated }));
              }}
            >
              <Text style={[styles.commitmentActionPillText, { color: '#00E5FF' }]}>Progress</Text>
            </TouchableOpacity>
          )}
          {commitment.status !== 'completed' && (
            <TouchableOpacity
              style={[styles.commitmentActionPill, { borderColor: '#2ECC71' }]}
              onPress={async () => {
                const ok = await updateCommitmentStatus(commitment.id, 'completed');
                if (ok) setCommitmentMap(prev => ({ ...prev, [entry.id]: { ...commitment, status: 'completed' } }));
              }}
            >
              <Text style={[styles.commitmentActionPillText, { color: '#2ECC71' }]}>Done</Text>
            </TouchableOpacity>
          )}
          {commitment.status !== 'open' && (
            <TouchableOpacity
              style={[styles.commitmentActionPill, { borderColor: '#FFA500' }]}
              onPress={async () => {
                const ok = await updateCommitmentStatus(commitment.id, 'open');
                if (ok) setCommitmentMap(prev => ({ ...prev, [entry.id]: { ...commitment, status: 'open' } }));
              }}
            >
              <Text style={[styles.commitmentActionPillText, { color: '#FFA500' }]}>Open</Text>
            </TouchableOpacity>
          )}
          {commitment.status !== 'abandoned' && (
            <TouchableOpacity
              style={[styles.commitmentActionPill, { borderColor: '#666666' }]}
              onPress={async () => {
                const ok = await updateCommitmentStatus(commitment.id, 'abandoned');
                if (ok) setCommitmentMap(prev => ({ ...prev, [entry.id]: { ...commitment, status: 'abandoned' } }));
              }}
            >
              <Text style={[styles.commitmentActionPillText, { color: '#666666' }]}>Drop</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const handleCommitToggle = async (entry: AnimatedEntry) => {
    const existing = commitmentMap[entry.id];
    if (existing) {
      // Cycle: open → completed → abandoned → open
      const next = existing.status === 'open' ? 'completed'
                 : existing.status === 'completed' ? 'abandoned'
                 : 'open';
      const ok = await updateCommitmentStatus(existing.id, next);
      if (ok) {
        setCommitmentMap(prev => ({ ...prev, [entry.id]: { ...existing, status: next } }));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } else {
      // Create new commitment
      const created = await createCommitment(entry.id);
      if (created) {
        setCommitmentMap(prev => ({ ...prev, [entry.id]: created }));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  };

  const renderDetailModal = () => {
    if (!selectedEntry) return null;

    const typeColor = TYPE_COLORS[selectedEntry.type] || '#00FFFF';
    const typeLabel = TYPE_LABELS[selectedEntry.type] || selectedEntry.type;
    const isVent = selectedEntry.type === 'vent';
    const isVitality = selectedEntry.type === 'vitality';
    const isMomentum = selectedEntry.type === 'momentum';
    const isDream = selectedEntry.type === 'dream';
    const isLogic = selectedEntry.type === 'logic';
    const isKitchen = selectedEntry.type === 'kitchen';

    const commitment = commitmentMap[selectedEntry.id];

    // Cast to any to access all possible column names from Supabase
    const entry = selectedEntry as any;

    // Try multiple possible column names - 'content' is where we save now
    const spokenText =
      entry.content ||          // Our primary column
      entry.raw_transcription ||
      entry.transcription ||
      entry.text ||
      entry.body ||
      entry.description ||
      null;

    console.log('=== MODAL OPENED ===');
    console.log('Entry ID:', entry.id);
    console.log('Entry type:', entry.type);
    console.log('Entry category:', entry.category);
    console.log('Entry content:', entry.content);
    console.log('Type flags:', { isVitality, isMomentum, isVent, isLogic, isDream, isKitchen });
    console.log('Spoken text resolved to:', spokenText);

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeDetail}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={[styles.modalTypeBadge, { backgroundColor: typeColor }]}>
                <Text style={styles.modalTypeBadgeText}>
                  {TYPE_ICONS[selectedEntry.type]} {typeLabel}
                </Text>
              </View>
              <TouchableOpacity onPress={closeDetail} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Title */}
            <Text style={[styles.modalTitle, { color: typeColor }]}>
              {fixName(selectedEntry.title)}
            </Text>

            {/* Meta info */}
            <View style={styles.modalMeta}>
              <Text style={styles.modalMetaText}>
                {ENERGY_ICONS[selectedEntry.energy]} {selectedEntry.energy} energy
              </Text>
              <Text style={styles.modalMetaText}>
                {formatDate(selectedEntry.created_at)}
              </Text>
            </View>

            {/* Divider */}
            <View style={[styles.modalDivider, { backgroundColor: typeColor }]} />

            {/* Commitment Toggle */}
            <View style={styles.commitmentPanel}>
              {!commitment ? (
                <TouchableOpacity
                  style={styles.commitButton}
                  onPress={() => handleCommitToggle(selectedEntry)}
                >
                  <Text style={styles.commitButtonText}>📋  Make this a Commitment</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.commitmentStatus}>
                  <View style={[
                    styles.commitmentStatusBadge,
                    commitment.status === 'open' && { backgroundColor: 'rgba(255, 165, 0, 0.15)', borderColor: '#FFA500' },
                    commitment.status === 'completed' && { backgroundColor: 'rgba(46, 204, 113, 0.15)', borderColor: '#2ECC71' },
                    commitment.status === 'abandoned' && { backgroundColor: 'rgba(100, 100, 100, 0.15)', borderColor: '#666666' },
                  ]}>
                    <Text style={[
                      styles.commitmentStatusText,
                      commitment.status === 'open' && { color: '#FFA500' },
                      commitment.status === 'completed' && { color: '#2ECC71' },
                      commitment.status === 'abandoned' && { color: '#666666' },
                    ]}>
                      {commitment.status === 'open' ? '📋 Open Commitment'
                       : commitment.status === 'completed' ? '✅ Completed'
                       : '🗑 Dropped'}
                    </Text>
                  </View>
                  <View style={styles.commitmentActions}>
                    {commitment.status !== 'completed' && (
                      <TouchableOpacity
                        style={[styles.commitActionBtn, { borderColor: '#2ECC71' }]}
                        onPress={async () => {
                          await updateCommitmentStatus(commitment.id, 'completed');
                          setCommitmentMap(prev => ({ ...prev, [selectedEntry.id]: { ...commitment, status: 'completed' } }));
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        }}
                      >
                        <Text style={[styles.commitActionText, { color: '#2ECC71' }]}>✅ Done</Text>
                      </TouchableOpacity>
                    )}
                    {commitment.status !== 'abandoned' && (
                      <TouchableOpacity
                        style={[styles.commitActionBtn, { borderColor: '#666666' }]}
                        onPress={async () => {
                          await updateCommitmentStatus(commitment.id, 'abandoned');
                          setCommitmentMap(prev => ({ ...prev, [selectedEntry.id]: { ...commitment, status: 'abandoned' } }));
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        }}
                      >
                        <Text style={[styles.commitActionText, { color: '#666666' }]}>🗑 Drop</Text>
                      </TouchableOpacity>
                    )}
                    {commitment.status !== 'open' && (
                      <TouchableOpacity
                        style={[styles.commitActionBtn, { borderColor: '#FFA500' }]}
                        onPress={async () => {
                          await updateCommitmentStatus(commitment.id, 'open');
                          setCommitmentMap(prev => ({ ...prev, [selectedEntry.id]: { ...commitment, status: 'open' } }));
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                      >
                        <Text style={[styles.commitActionText, { color: '#FFA500' }]}>↩ Reopen</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {commitment.reasoning && (
                    <Text style={styles.commitmentReasoning}>"{commitment.reasoning}"</Text>
                  )}
                </View>
              )}
            </View>

            {/* Content */}
            <ScrollView style={styles.modalScrollView} showsVerticalScrollIndicator={true}>
              <View style={{ marginTop: 10, paddingBottom: 40 }}>
                {/* Context Label */}
                <Text style={{
                  color: '#666666',
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 2,
                  marginBottom: 15
                }}>
                  {isVitality ? 'Life Force' :
                   isMomentum ? 'Next Step' :
                   isVent ? 'Captured Thought' :
                   isLogic ? 'Deep Logic' :
                   isDream ? 'The Vision' :
                   isKitchen ? 'Recipe Note' :
                   'Original Audio'}
                </Text>

                {/* The Main Text Body */}
                <View style={{
                  borderLeftWidth: 3,
                  borderLeftColor: typeColor,
                  paddingLeft: 20,
                  marginVertical: 10
                }}>
                  <Text style={[
                    styles.transcriptionBase,
                    isVitality && styles.vitalityText,
                    isMomentum && styles.momentumText,
                    isVent && styles.ventText,
                    isLogic && styles.logicText,
                    isDream && styles.dreamVisionText,
                    isKitchen && styles.kitchenText,
                  ]}>
                    {spokenText ? `"${fixName(spokenText)}"` : "No transcription captured"}
                  </Text>
                </View>

                {/* Renaissance Footer */}
                <Text style={styles.renaissanceFooterText}>
                  {isVitality ? "🌿 This nourishes your whole self." :
                   isMomentum ? "⚙️ Small steps build unstoppable momentum." :
                   isVent ? "💫 Acknowledging feelings is progress." :
                   isLogic ? "🧠 Deep thoughts shape reality." :
                   isDream ? "🚀 One small step brings this closer." :
                   isKitchen ? "🍳 Heritage flavors, preserved." :
                   "✓ Recorded to permanent memory."}
                </Text>
              </View>
            </ScrollView>

            {/* Delete button */}
            <TouchableOpacity
              onPress={() => handleDeleteEntry(selectedEntry)}
              style={styles.deleteEntryButton}
            >
              <Text style={styles.deleteEntryButtonText}>🗑  Delete this entry</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const renderCommitmentGate = () => {
    if (!gateVisible) return null;

    return (
      <Modal
        animationType="fade"
        transparent={true}
        visible={gateVisible}
        onRequestClose={closeGate}
      >
        <View style={styles.gateOverlay}>
          <View style={styles.gateCard}>
            <Text style={styles.gateTitle}>Commitment Checkpoint</Text>
            <Text style={styles.gateBody}>
              You have {gateOpenCount} open commitments. Record anyway, or close one first?
            </Text>

            {gateCountdown > 0 ? (
              <Text style={styles.gateCountdown}>You can continue in {gateCountdown}…</Text>
            ) : (
              <Text style={styles.gateReady}>You can continue now.</Text>
            )}

            <View style={styles.gateActions}>
              <TouchableOpacity
                style={[
                  styles.gatePrimaryButton,
                  gateCountdown > 0 && styles.gatePrimaryButtonDisabled,
                ]}
                disabled={gateCountdown > 0}
                onPress={handleRecordAnyway}
              >
                <Text style={styles.gatePrimaryButtonText}>Continue</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.gateSecondaryButton}
                onPress={closeGate}
              >
                <Text style={styles.gateSecondaryButtonText}>Close one first</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderCommitmentReview = () => {
    if (!commitmentReviewVisible) return null;

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={commitmentReviewVisible}
        onRequestClose={closeCommitmentReview}
      >
        <View style={styles.gateOverlay}>
          <View style={styles.reviewCard}>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewHeaderTextWrap}>
                <Text style={styles.reviewTitle}>AI Commitment Review</Text>
                <Text style={styles.reviewBody}>
                  The Strategist found {pendingCommitmentReview.length} thought{pendingCommitmentReview.length === 1 ? '' : 's'} worth tracking. Keep the ones you want, dismiss the rest.
                </Text>
              </View>
              <TouchableOpacity onPress={closeCommitmentReview} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.reviewList} showsVerticalScrollIndicator={false}>
              {pendingCommitmentReview.map((item) => {
                const typeColor = TYPE_COLORS[item.entry.type] || CYAN;
                return (
                  <View key={item.entry.id} style={styles.reviewItemCard}>
                    <Text style={styles.reviewItemTitle}>{fixName(item.entry.title)}</Text>
                    <Text style={[styles.reviewItemMeta, { color: typeColor }]}>
                      {TYPE_LABELS[item.entry.type] || item.entry.type} · {ENERGY_ICONS[item.entry.energy] || '●'} {item.entry.energy}
                    </Text>
                    <Text style={styles.reviewItemReasoning}>{item.reasoning}</Text>

                    <View style={styles.reviewActions}>
                      <TouchableOpacity
                        style={styles.reviewKeepButton}
                        onPress={() => acceptSuggestedCommitment(item)}
                      >
                        <Text style={styles.reviewKeepButtonText}>Keep Commitment</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.reviewDismissButton}
                        onPress={() => dismissSuggestedCommitment(item.entry.id)}
                      >
                        <Text style={styles.reviewDismissButtonText}>Dismiss</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.reviewDoneButton} onPress={closeCommitmentReview}>
              <Text style={styles.reviewDoneButtonText}>
                {pendingCommitmentReview.length === 0 ? 'Close' : 'Done Reviewing'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <Text style={styles.header}>Renaissance</Text>
      <Text style={styles.versionBadge}>build:{BUILD_LABEL} · ch:{channel} · upd:{updateIdShort}</Text>

      <View style={styles.modeTabs}>
        <TouchableOpacity
          style={[styles.modeTab, activeTab === 'capture' && styles.modeTabActive]}
          onPress={() => setActiveTab('capture')}
        >
          <Text style={[styles.modeTabText, activeTab === 'capture' && styles.modeTabTextActive]}>Capture</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeTab, activeTab === 'focus' && styles.modeTabActive]}
          onPress={() => setActiveTab('focus')}
        >
          <Text style={[styles.modeTabText, activeTab === 'focus' && styles.modeTabTextActive]}>Focus</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeTab, activeTab === 'commitments' && styles.modeTabActive]}
          onPress={() => setActiveTab('commitments')}
        >
          <Text style={[styles.modeTabText, activeTab === 'commitments' && styles.modeTabTextActive]}>Commitments</Text>
        </TouchableOpacity>
      </View>

      {/* Spirit Animal */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setIsSpiritAnimalCollapsed(!isSpiritAnimalCollapsed);
        }}
        style={[
          styles.spiritAnimalContainer,
          isSpiritAnimalCollapsed && styles.spiritAnimalContainerCollapsed,
        ]}
      >
        <View style={styles.spiritAnimalTopRow}>
          <View style={styles.spiritAnimalHeaderSpacer} />
          <View style={styles.spiritAnimalHeader}>
            <Text style={styles.spiritAnimalLabel}>Spirit Animal</Text>
            <View style={styles.spiritAnimalTitleGroup}>
              <Text style={styles.spiritAnimalIcon}>{spiritAnimalIcon}</Text>
              <Text style={styles.spiritAnimal}>{spiritAnimalTitle}</Text>
            </View>
          </View>
          <View style={styles.spiritAnimalToggle}>
            <Text style={styles.spiritAnimalChevron}>
              {isSpiritAnimalCollapsed ? '▼' : '▲'}
            </Text>
          </View>
        </View>
        {!isSpiritAnimalCollapsed && (
          <Text style={styles.spiritAnimalReading}>{spiritAnimalReading}</Text>
        )}
      </TouchableOpacity>

      {/* Accountability Banner - Bottleneck Detector */}
      {ENABLE_BOTTLENECK_BANNER && showBottleneckBanner && bottleneck && (
        <View style={styles.accountabilityBanner}>
          <View style={styles.bottleneckContent}>
            <Text style={styles.bottleneckLabel}>BOTTLENECK DETECTED</Text>
            <Text style={styles.bottleneckText}>{bottleneck}</Text>
          </View>
          <TouchableOpacity
            style={styles.completedButton}
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setShowBottleneckBanner(false);
            }}
          >
            <Text style={styles.completedButtonText}>COMPLETED</Text>
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'capture' && (
      <>
      {/* Fixed Header Area - Morning Mirror */}
      <View style={styles.fixedHeader}>
        {/* Morning Mirror Card - Daily Synthesis from Yesterday */}
        {(morningMirror || isLoadingMirror) && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setIsMirrorCollapsed(!isMirrorCollapsed);
            }}
            style={[
              styles.morningMirrorCard,
              isMirrorCollapsed && styles.morningMirrorCardCollapsed,
            ]}
          >
            <View style={styles.morningMirrorHeader}>
              <Text style={styles.morningMirrorIcon}>🪞</Text>
              <View style={styles.morningMirrorTitleContainer}>
                <Text style={styles.morningMirrorTitle}>Morning Mirror</Text>
                {!isMirrorCollapsed && !isLoadingMirror && mirrorSourceDate && (
                  <Text style={styles.morningMirrorSubtitle}>
                    Your full-day reflection from {formatDateForDisplay(mirrorSourceDate)}
                  </Text>
                )}
                {isLoadingMirror && (
                  <Text style={styles.morningMirrorSubtitle}>Analyzing yesterday...</Text>
                )}
              </View>
              <Text style={styles.morningMirrorChevron}>
                {isMirrorCollapsed ? '▼' : '▲'}
              </Text>
            </View>
            {!isMirrorCollapsed && !isLoadingMirror && morningMirror && (
              <Text style={styles.morningMirrorSynthesis}>"{morningMirror}"</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Recording indicator */}
      {isRecording && (
        <View style={styles.recordingIndicator}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>Recording...</Text>
        </View>
      )}

      {/* Processing indicator */}
      {isProcessing && !isRecording && (
        <View style={styles.recordingIndicator}>
          <Text style={styles.processingText}>●</Text>
          <Text style={styles.processingText}>{statusText}</Text>
        </View>
      )}

      {/* Pulsing Button */}
      <Animated.View
        style={[
          styles.buttonContainer,
          {
            transform: [
              { scale: isRecording ? recordingAnim : isProcessing ? processingAnim : pulseAnim },
            ],
          },
        ]}
      >
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isProcessing || gateVisible || isRecording}
          style={[
            styles.button,
            isRecording && styles.buttonRecording,
            isProcessing && !isRecording && styles.buttonProcessing,
          ]}
        >
          <View style={[
            styles.buttonInner,
            isRecording && styles.buttonInnerRecording,
            isProcessing && !isRecording && styles.buttonInnerProcessing,
          ]}>
            <Text style={styles.buttonIcon}>{isRecording ? '●' : '◉'}</Text>
          </View>
        </Pressable>
      </Animated.View>

      <Text style={styles.hint}>
        {isRecording ? 'Release to process' : statusText}
      </Text>
      </>
      )}

      {/* Entry List - Fills remaining space */}
      <View style={styles.entryListContainer}>
        {activeTab !== 'capture' && (
          <Text style={styles.entryListHeader}>
            {activeTab === 'commitments'
              ? `Commitments (${commitmentItems.length})`
              : 'Focus Progression'}
          </Text>
        )}

        {activeTab === 'capture' ? (
          <ScrollView
            style={styles.entryList}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor="#00FFFF"
              />
            }
          >
            <View style={styles.progressionCard}>
              <View style={styles.progressionPrimaryBlock}>
                <Text style={styles.progressionSectionLabel}>Today&apos;s next move</Text>
                {suggestedStarterStep ? (
                  <>
                    <Text style={styles.progressionPrimaryText}>{suggestedStarterStep}</Text>
                    {!dailyMove.trim() && primaryFocus && (
                      <Text style={styles.progressionMeta}>Derived from: {fixName(primaryFocus.entry.title)}</Text>
                    )}
                    {!!dailyWhen.trim() && (
                      <Text style={styles.progressionMeta}>When: {dailyWhen.trim()}</Text>
                    )}
                    {!!dailyBlocker.trim() && (
                      <Text style={styles.progressionMeta}>Watch-out: {dailyBlocker.trim()}</Text>
                    )}
                    {!!focusReason && !dailyMove.trim() && (
                      <Text style={styles.progressionMeta}>Why this surfaced: {focusReason}</Text>
                    )}
                  </>
                ) : primaryFocus ? (
                  <>
                    <Text style={styles.progressionPrimaryText}>{fixName(primaryFocus.entry.title)}</Text>
                    <Text style={styles.progressionMeta}>Pulled from your open commitments. Shrink it in Focus if this still feels too big.</Text>
                  </>
                ) : (
                  <Text style={styles.progressionEmptyText}>No active step yet. Use Focus to pick one 5-minute starter.</Text>
                )}
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterBar}
              contentContainerStyle={styles.filterBarContent}
            >
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  activeFilter === null && styles.filterChipActive,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveFilter(null);
                }}
              >
                <Text style={[
                  styles.filterChipText,
                  activeFilter === null && styles.filterChipTextActive,
                ]}>
                  All
                </Text>
              </TouchableOpacity>
              {renaissanceConfig.categories.map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={[
                    styles.filterChip,
                    activeFilter === category.id && styles.filterChipActive,
                    activeFilter === category.id && { borderColor: category.color },
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveFilter(category.id);
                  }}
                >
                  <Text style={styles.filterChipIcon}>{category.icon}</Text>
                  <Text style={[
                    styles.filterChipText,
                    activeFilter === category.id && styles.filterChipTextActive,
                    activeFilter === category.id && { color: category.color },
                  ]}>
                    {category.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <FlatList
              data={filteredCaptureEntries}
              renderItem={renderEntry}
              keyExtractor={(item) => item.id}
              style={styles.captureThoughtsList}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={filteredCaptureEntries.length > 0 ? renderCaptureListFooter : null}
            />
          </ScrollView>
        ) : activeTab === 'focus' ? (
          <ScrollView
            style={styles.entryList}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor="#00FFFF"
              />
            }
          >
            <View style={styles.coachCard}>
              <Text style={styles.coachCardTitle}>Right Now</Text>
              <Text style={styles.coachCardBody}>This layer narrows the day without deleting the rest of your life. Keep the ledger in Commitments. Pick the next visible move here.</Text>

              {!!focusRecommendation?.narrative?.trim() && (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.focusNarrativeCard}
                  onPress={() => setIsFocusNudgeExpanded((prev) => !prev)}
                >
                  <Text style={styles.focusNarrativeLabel}>
                    {focusRecommendation.phase ? `${focusRecommendation.phase} nudge` : 'Daily nudge'}
                  </Text>
                  <Text
                    style={styles.focusNarrativeText}
                    numberOfLines={isFocusNudgeExpanded ? undefined : 5}
                  >
                    {focusRecommendation.narrative.trim()}
                  </Text>
                  {focusRecommendation.narrative.trim().length > 220 && (
                    <Text style={styles.focusNarrativeToggle}>
                      {isFocusNudgeExpanded ? 'Show less' : 'Read full nudge'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}

              <View style={styles.focusCallout}>
                <Text style={styles.focusCalloutLabel}>Primary Focus</Text>
                <Text style={styles.focusCalloutTitle}>
                  {primaryFocus ? fixName(primaryFocus.entry.title) : 'Nothing selected yet'}
                </Text>
                <Text style={styles.focusCalloutBody}>
                  {primaryFocus
                    ? 'This rises because it is meaningful and under-tended. Treat it as today’s best candidate, not a moral judgment.'
                    : 'Open commitments exist, but no focus move has been chosen yet.'}
                </Text>
                {!!focusReason && (
                  <Text style={styles.focusReasonText}>{focusReason}</Text>
                )}
                {!!suggestedStarterStep && (
                  <Text style={styles.focusStarterText}>5-minute starter: {suggestedStarterStep}</Text>
                )}
              </View>

              <View style={styles.focusMeaningCard}>
                <Text style={styles.focusMeaningLabel}>Why This Matters</Text>
                <Text style={styles.focusMeaningText}>{whyThisMatters}</Text>
              </View>

              <View style={styles.focusValuesCard}>
                <Text style={styles.focusValuesLabel}>Values Mirror</Text>
                <Text style={styles.focusValuesText}>{valuesMirrorText}</Text>
                {topValues.length > 0 && (
                  <View style={styles.focusValuesPills}>
                    {topValues.map((value) => (
                      <View key={value.key} style={styles.focusValuePill}>
                        <Text style={styles.focusValuePillText}>
                          {value.label}
                          {value.gap >= 3 ? ' !' : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {secondaryFocus.length > 0 && (
                <View style={styles.focusSupportList}>
                  <Text style={styles.progressionSectionLabel}>Still alive, but not first</Text>
                  {secondaryFocus.map(({ entry }) => (
                    <Text key={entry.id} style={styles.focusSupportItem}>• {fixName(entry.title)}</Text>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        ) : activeTab === 'commitments' ? (
          commitmentItems.length === 0 ? (
            <View style={styles.emptyCommitmentsState}>
              <Text style={styles.emptyCommitmentsText}>No commitments yet. Open a thought and tap "Make this a Commitment".</Text>
            </View>
          ) : (
            <FlatList
              data={commitmentItems}
              renderItem={renderCommitmentItem}
              keyExtractor={(item) => item.commitment.id}
              style={styles.entryList}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={onRefresh}
                  tintColor="#00FFFF"
                />
              }
            />
          )
        ) : null}
      </View>

      {/* Detail Modal */}
      {renderDetailModal()}

      {/* Gate #2 */}
      {renderCommitmentGate()}

      {/* AI commitment review */}
      {renderCommitmentReview()}
    </View>
  );
}

const CYAN = '#00FFFF';
const CYAN_DIM = '#00CCCC';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    paddingTop: 50,
  },
  header: {
    fontSize: 28,
    fontWeight: '300',
    color: CYAN,
    letterSpacing: 4,
    marginBottom: 4,
  },
  versionBadge: {
    color: '#666666',
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  modeTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  modeTab: {
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#0b0b0b',
  },
  modeTabActive: {
    borderColor: CYAN,
    backgroundColor: 'rgba(0,255,255,0.08)',
  },
  modeTabText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: CYAN,
  },
  spiritAnimalContainer: {
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 76,
    backgroundColor: 'rgba(0, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 255, 0.1)',
  },
  spiritAnimalContainerCollapsed: {
    minHeight: 0,
    paddingVertical: 12,
  },
  spiritAnimalTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spiritAnimalHeaderSpacer: {
    width: 24,
  },
  spiritAnimalHeader: {
    flex: 1,
    justifyContent: 'center',
  },
  spiritAnimalTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  spiritAnimalToggle: {
    width: 24,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  spiritAnimalLabel: {
    fontSize: 12,
    color: '#666666',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  spiritAnimalIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  spiritAnimal: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
    textAlign: 'center',
  },
  spiritAnimalReading: {
    color: '#9FD7DD',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 12,
  },
  spiritAnimalChevron: {
    color: '#88C9D1',
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.7,
  },
  // Accountability Banner
  accountabilityBanner: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#FF3B30',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  bottleneckContent: {
    flex: 1,
    marginRight: 12,
  },
  bottleneckLabel: {
    color: '#FF3B30',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  bottleneckText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  completedButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  completedButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  // Fixed Header Area (Filter + Mirror)
  fixedHeader: {
    width: '100%',
    maxHeight: 260,
    zIndex: 10,
  },
  // Filter Bar
  filterBar: {
    maxHeight: 44,
    marginBottom: 12,
  },
  filterBarContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterChipActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: '#00FFFF',
  },
  filterChipIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  filterChipText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#00FFFF',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
    marginRight: 8,
  },
  recordingText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '500',
  },
  processingText: {
    color: CYAN,
    fontSize: 14,
    fontWeight: '500',
    marginRight: 8,
  },
  buttonContainer: {
    marginTop: 12,
    marginBottom: 8,
  },
  button: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: CYAN,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: CYAN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  buttonRecording: {
    borderColor: '#FF3B30',
    shadowColor: '#FF3B30',
  },
  buttonProcessing: {
    borderColor: CYAN,
    shadowColor: CYAN,
    shadowOpacity: 1,
    shadowRadius: 30,
  },
  buttonInner: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: CYAN,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: CYAN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 30,
  },
  buttonInnerRecording: {
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
  },
  buttonInnerProcessing: {
    backgroundColor: CYAN,
    shadowColor: CYAN,
    shadowOpacity: 1,
    shadowRadius: 40,
  },
  buttonIcon: {
    fontSize: 28,
    color: '#000000',
  },
  hint: {
    color: '#666666',
    fontSize: 14,
    marginTop: 8,
  },
  entryListContainer: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 20,
    marginTop: 8,
  },
  entryListHeader: {
    color: CYAN_DIM,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
    letterSpacing: 1,
  },
  progressionCard: {
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.14)',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#0b0f10',
    marginBottom: 18,
  },
  progressionPrimaryBlock: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  progressionSectionLabel: {
    color: '#88C9D1',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  progressionPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    marginBottom: 8,
  },
  progressionMeta: {
    color: '#9AA7AA',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  progressionEmptyText: {
    color: '#7D8C90',
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  captureThoughtsList: {
    flexGrow: 0,
  },
  entryList: {
    flex: 1,
  },
  emptyCommitmentsState: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#0b0b0b',
  },
  emptyCommitmentsText: {
    color: '#9a9a9a',
    fontSize: 14,
    lineHeight: 20,
  },
  captureListFooter: {
    paddingVertical: 18,
    paddingHorizontal: 4,
  },
  captureListFooterText: {
    color: '#666666',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  commitmentListCard: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#0b0b0b',
  },
  commitmentListTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  commitmentListTitleWrap: {
    flex: 1,
  },
  commitmentListStatusBadge: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#101010',
  },
  commitmentListStatusOpen: {
    borderColor: '#FFA500',
    backgroundColor: 'rgba(255, 165, 0, 0.12)',
  },
  commitmentListStatusDone: {
    borderColor: '#2ECC71',
    backgroundColor: 'rgba(46, 204, 113, 0.12)',
  },
  commitmentListStatusDropped: {
    borderColor: '#777777',
    backgroundColor: 'rgba(130, 130, 130, 0.12)',
  },
  commitmentListStatusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  commitmentListTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  commitmentListMeta: {
    fontSize: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  commitmentProgressMeta: {
    color: '#8a8a8a',
    fontSize: 12,
    marginBottom: 8,
  },
  commitmentListActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  commitmentActionPill: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#111111',
  },
  commitmentActionPillText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  coachCard: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#0b0b0b',
  },
  coachCardTitle: {
    color: '#00E5FF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  coachCardBody: {
    color: '#E6E6E6',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  coachCardCta: {
    color: '#8a8a8a',
    fontSize: 12,
    fontStyle: 'italic',
  },
  focusCallout: {
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 0, 0.28)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(255, 165, 0, 0.06)',
    marginTop: 6,
  },
  focusNarrativeCard: {
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.22)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(0, 229, 255, 0.06)',
    marginTop: 6,
    marginBottom: 12,
  },
  focusNarrativeLabel: {
    color: '#7FEFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  focusNarrativeText: {
    color: '#E9FDFF',
    fontSize: 13,
    lineHeight: 20,
  },
  focusNarrativeToggle: {
    color: '#8EEBFF',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  focusCalloutLabel: {
    color: '#FFC36B',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  focusCalloutTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
    marginBottom: 6,
  },
  focusCalloutBody: {
    color: '#DDD2C1',
    fontSize: 13,
    lineHeight: 19,
  },
  focusReasonText: {
    color: '#F7D39A',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    fontStyle: 'italic',
  },
  focusStarterText: {
    color: '#FFE4B3',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    fontWeight: '600',
  },
  focusMeaningCard: {
    borderWidth: 1,
    borderColor: 'rgba(46, 204, 113, 0.24)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(46, 204, 113, 0.06)',
    marginTop: 12,
  },
  focusMeaningLabel: {
    color: '#8DE5B1',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  focusMeaningText: {
    color: '#E8F8EF',
    fontSize: 13,
    lineHeight: 20,
  },
  focusValuesCard: {
    borderWidth: 1,
    borderColor: 'rgba(255, 217, 61, 0.22)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(255, 217, 61, 0.05)',
    marginTop: 12,
  },
  focusValuesLabel: {
    color: '#FFD971',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  focusValuesText: {
    color: '#FFF6D8',
    fontSize: 13,
    lineHeight: 20,
  },
  focusValuesPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  focusValuePill: {
    borderWidth: 1,
    borderColor: 'rgba(255, 217, 61, 0.3)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255, 217, 61, 0.08)',
  },
  focusValuePillText: {
    color: '#FFE9A6',
    fontSize: 12,
    fontWeight: '700',
  },
  focusSupportList: {
    marginTop: 12,
  },
  focusSupportItem: {
    color: '#D7D7D7',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  coachInputLabel: {
    color: '#B8B8B8',
    fontSize: 12,
    marginBottom: 4,
    marginTop: 4,
  },
  coachInput: {
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 10,
    color: '#FFFFFF',
    fontSize: 13,
    marginBottom: 8,
    minHeight: 52,
    textAlignVertical: 'top',
    backgroundColor: '#101010',
  },
  alignmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  alignmentPill: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#111',
  },
  alignmentPillActive: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.15)',
  },
  alignmentPillText: {
    color: '#AAA',
    fontSize: 12,
    fontWeight: '600',
  },
  alignmentPillTextActive: {
    color: '#00E5FF',
  },
  coachSaveButton: {
    marginTop: 2,
    backgroundColor: '#00E5FF',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  coachSaveButtonText: {
    color: '#001217',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.4,
  },
  entryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    position: 'relative',
    overflow: 'hidden',
  },
  entryGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },
  entryDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  entryDotIcon: {
    fontSize: 12,
    color: '#000000',
  },
  entryContent: {
    flex: 1,
  },
  entryText: {
    fontSize: 16,
    marginBottom: 4,
    color: '#FFFFFF',
  },
  entryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  entryType: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginRight: 8,
  },
  entryEnergy: {
    fontSize: 14,
  },
  entryArrow: {
    fontSize: 24,
    color: '#444444',
    marginLeft: 8,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
    height: '80%', // Change maxHeight to height
    borderTopWidth: 1,
    borderColor: '#222222',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTypeBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  modalTypeBadgeText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '600',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#222222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#888888',
    fontSize: 18,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 12,
  },
  modalMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalMetaText: {
    color: '#666666',
    fontSize: 14,
  },
  modalDivider: {
    height: 2,
    marginBottom: 20,
    opacity: 0.3,
  },
  modalScrollView: {
    flex: 1,           // This forces it to fill the available space
    minHeight: 200,    // This guarantees at least 200 pixels of room for your text
    marginTop: 10,
  },
  ventHeader: {
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 3,
    borderLeftColor: '#FF6B6B',
  },
  ventHeaderText: {
    color: '#FF6B6B',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  ventSubtext: {
    color: '#888888',
    fontSize: 14,
    fontStyle: 'italic',
  },
  transcriptionLabel: {
    color: '#666666',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  transcriptionText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 28,
  },
  ventTranscriptionText: {
    fontStyle: 'italic',
    color: '#CCCCCC',
    fontSize: 20,
    lineHeight: 32,
    paddingLeft: 16,
    borderLeftWidth: 2,
    borderLeftColor: '#FF6B6B',
  },
  noTranscriptionText: {
    color: '#666666',
    fontSize: 16,
    fontStyle: 'italic',
  },
  ventFooter: {
    marginTop: 24,
    padding: 16,
    backgroundColor: 'rgba(255, 107, 107, 0.05)',
    borderRadius: 12,
  },
  ventFooterText: {
    color: '#888888',
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  // Aspiration / Dream styles
  aspirationHeader: {
    backgroundColor: 'rgba(255, 217, 61, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 3,
    borderLeftColor: '#FFD93D',
  },
  aspirationHeaderText: {
    color: '#FFD93D',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  aspirationSubtext: {
    color: '#888888',
    fontSize: 14,
    fontStyle: 'italic',
  },
  aspirationTranscriptionText: {
    color: '#FFD93D',
    fontSize: 20,
    lineHeight: 32,
    fontWeight: '300',
    letterSpacing: 0.5,
    paddingLeft: 16,
    borderLeftWidth: 2,
    borderLeftColor: '#FFD93D',
  },
  aspirationFooter: {
    marginTop: 24,
    padding: 16,
    backgroundColor: 'rgba(255, 217, 61, 0.05)',
    borderRadius: 12,
  },
  aspirationFooterText: {
    color: '#FFD93D',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '500',
  },

  // Journal page style for Vents
  journalPage: {
    backgroundColor: '#0d0d0d',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
  },
  journalDate: {
    color: '#555555',
    fontSize: 12,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  journalText: {
    color: '#CCCCCC',
    fontSize: 18,
    lineHeight: 30,
    fontStyle: 'italic',
    letterSpacing: 0.3,
  },
  journalTextEmpty: {
    color: '#444444',
    fontSize: 16,
    fontStyle: 'italic',
  },

  // Dream card style for Aspirations
  dreamCard: {
    backgroundColor: 'rgba(255, 217, 61, 0.03)',
    borderRadius: 20,
    padding: 32,
    marginBottom: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 217, 61, 0.15)',
  },
  dreamQuoteMark: {
    color: '#FFD93D',
    fontSize: 48,
    fontWeight: '300',
    opacity: 0.6,
    marginBottom: -10,
  },
  dreamQuoteMarkEnd: {
    color: '#FFD93D',
    fontSize: 48,
    fontWeight: '300',
    opacity: 0.6,
    marginTop: -10,
    alignSelf: 'flex-end',
  },
  dreamText: {
    color: '#FFD93D',
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '300',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  dreamTextEmpty: {
    color: 'rgba(255, 217, 61, 0.4)',
    fontSize: 18,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // Task transcription style
  taskTranscriptionText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 28,
    backgroundColor: 'rgba(0, 255, 255, 0.03)',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#00FFFF',
  },

  // Transcription text styles
  transcriptionBase: {
    fontSize: 18,
    lineHeight: 28,
    color: '#FFFFFF',
  },
  vitalityText: {
    // Life force - green, grounding
    fontSize: 19,
    lineHeight: 32,
    color: '#2ECC71',
  },
  momentumText: {
    // Momentum - cyan, action-oriented
    fontSize: 17,
    lineHeight: 26,
    color: '#00FFFF',
  },
  ventText: {
    // Emotional processing - warm coral, readable
    fontSize: 20,
    lineHeight: 34,
    fontStyle: 'italic',
    color: '#FF6B6B',
  },
  dreamVisionText: {
    // Aspirations - golden, inspiring
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '300',
    letterSpacing: 0.5,
    color: '#FFD93D',
  },
  logicText: {
    // "Deep Logic" - larger, spaced-out for reading abstract thoughts
    fontSize: 22,
    lineHeight: 38,
    letterSpacing: 0.8,
    fontStyle: 'italic',
    color: '#9B59B6',
  },
  kitchenText: {
    // Kuli's Kitchen - warm orange, homey feel
    fontSize: 19,
    lineHeight: 30,
    color: '#E67E22',
  },
  taskBodyText: {
    // Drudgery - clean cyan, functional
    fontSize: 17,
    lineHeight: 26,
    color: '#00FFFF',
  },

  // Morning Mirror Card - Main Screen (Philosophy Style)
  morningMirrorCard: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 92,
    backgroundColor: 'rgba(255, 107, 107, 0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.12)',
  },
  morningMirrorCardCollapsed: {
    minHeight: 0,
    paddingVertical: 12,
  },
  morningMirrorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  morningMirrorIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  morningMirrorTitleContainer: {
    flex: 1,
  },
  morningMirrorTitle: {
    color: '#FF6B6B',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  morningMirrorSubtitle: {
    color: '#666666',
    fontSize: 9,
    marginTop: 2,
    fontStyle: 'italic',
  },
  morningMirrorChevron: {
    color: '#FF6B6B',
    fontSize: 10,
    opacity: 0.6,
  },
  morningMirrorSynthesis: {
    color: '#DDDDDD',
    fontSize: 13,
    lineHeight: 20,
    fontStyle: 'italic',
    letterSpacing: 0.2,
    textAlign: 'center',
    marginTop: 12,
  },

  // ── Commitment styles ──────────────────────────────────────────────────────
  entryItemOpen: {
    borderLeftWidth: 3,
    borderLeftColor: '#FFA500',
  },
  entryItemDone: {
    opacity: 0.5,
  },
  commitmentBadge: {
    marginLeft: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  commitmentBadgeOpen: {
    backgroundColor: 'rgba(255, 165, 0, 0.12)',
    borderColor: '#FFA500',
  },
  commitmentBadgeDone: {
    backgroundColor: 'rgba(46, 204, 113, 0.12)',
    borderColor: '#2ECC71',
  },
  commitmentBadgeAbandoned: {
    backgroundColor: 'rgba(100, 100, 100, 0.12)',
    borderColor: '#555555',
  },
  commitmentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#FFFFFF',
  },
  commitmentPanel: {
    marginBottom: 16,
  },
  commitButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 0, 0.4)',
    backgroundColor: 'rgba(255, 165, 0, 0.06)',
    alignItems: 'center',
  },
  commitButtonText: {
    color: '#FFA500',
    fontSize: 14,
    fontWeight: '600',
  },
  commitmentStatus: {
    gap: 10,
  },
  commitmentStatusBadge: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  commitmentStatusText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  commitmentActions: {
    flexDirection: 'row',
    gap: 10,
  },
  commitActionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  commitActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  commitmentReasoning: {
    color: '#8C8C8C',
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 18,
    fontWeight: '500',
  },
  renaissanceFooterText: {
    marginTop: 30,
    color: '#8A8A8A',
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
    fontWeight: '600',
    lineHeight: 20,
  },

  // Gate #2 modal
  gateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  gateCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 0, 0.5)',
    borderRadius: 16,
    padding: 20,
  },
  reviewCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '82%',
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.35)',
    borderRadius: 16,
    padding: 18,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
  },
  reviewHeaderTextWrap: {
    flex: 1,
  },
  reviewTitle: {
    color: '#00E5FF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  reviewBody: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 21,
  },
  reviewList: {
    maxHeight: 420,
  },
  reviewItemCard: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#0d0d0d',
  },
  reviewItemTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  reviewItemMeta: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  reviewItemReasoning: {
    color: '#CFCFCF',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  reviewActions: {
    flexDirection: 'row',
    gap: 8,
  },
  reviewKeepButton: {
    flex: 1,
    backgroundColor: '#00E5FF',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  reviewKeepButtonText: {
    color: '#001217',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  reviewDismissButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#666666',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  reviewDismissButtonText: {
    color: '#BBBBBB',
    fontSize: 13,
    fontWeight: '600',
  },
  reviewDoneButton: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#101010',
  },
  reviewDoneButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  gateTitle: {
    color: '#FFA500',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  gateBody: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
  },
  gateCountdown: {
    color: '#FFA500',
    fontSize: 13,
    marginBottom: 16,
    fontWeight: '600',
  },
  gateReady: {
    color: '#2ECC71',
    fontSize: 13,
    marginBottom: 16,
    fontWeight: '600',
  },
  gateActions: {
    gap: 10,
  },
  gatePrimaryButton: {
    backgroundColor: '#FFA500',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  gatePrimaryButtonDisabled: {
    opacity: 0.45,
  },
  gatePrimaryButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  gateSecondaryButton: {
    borderWidth: 1,
    borderColor: '#666666',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  gateSecondaryButtonText: {
    color: '#BBBBBB',
    fontSize: 14,
    fontWeight: '600',
  },

  // Debug info
  debugInfo: {
    marginTop: 20,
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
  },
  debugText: {
    color: '#555555',
    fontSize: 11,
    fontFamily: 'monospace',
  },

  // Guaranteed content display
  guaranteedContent: {
    marginTop: 30,
    padding: 20,
    backgroundColor: 'rgba(0, 255, 255, 0.1)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#00FFFF',
  },
  guaranteedLabel: {
    color: '#00FFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 12,
  },
  guaranteedText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 28,
  },
  deleteEntryButton: {
    marginTop: 12,
    marginHorizontal: 4,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF4444',
    alignItems: 'center',
  },
  deleteEntryButtonText: {
    color: '#FF4444',
    fontSize: 14,
    fontWeight: '600',
  },
});
