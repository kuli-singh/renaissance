import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
// version badge values are sourced from app config constants below
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
} from 'react-native';
import { transcribeAudio, processThought, generateDailyMirror, renaissanceConfig } from './lib/openai';
import {
  Entry,
  Commitment,
  fetchEntries,
  insertThought,
  getTodaysSpiritAnimal,
  fetchYesterdaysVents,
  fetchCommitments,
  createCommitment,
  updateCommitmentStatus,
} from './lib/supabase';

// Fix voice-to-text name errors in display
const fixName = (text?: string | null): string => {
  if (!text) return '';
  return text.replace(/\bBooper\b/gi, 'BUPA');
};

interface AnimatedEntry extends Entry {
  glowAnim: Animated.Value;
  slideAnim: Animated.Value;
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
};

// Get today's date string for comparison
const getTodayDateString = () => new Date().toISOString().split('T')[0];

// Get yesterday's date string
const getYesterdayDateString = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
};

const APP_VERSION = '1.0.0';
const APP_RUNTIME = 'exposdk:54.0.0';

// Format date for display (e.g., "February 13")
const formatDateForDisplay = (dateStr: string) => {
  const date = new Date(dateStr + 'T12:00:00'); // Add time to avoid timezone issues
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
};

// Check if we should generate a new Morning Mirror
// Only generates once per day, on first app open after 4 AM
const shouldGenerateMirror = (lastGeneratedDate: string | null): boolean => {
  const now = new Date();
  const today = getTodayDateString();
  const currentHour = now.getHours();

  // If never generated, generate now (if after 4 AM)
  if (!lastGeneratedDate) {
    return currentHour >= 4;
  }

  // If already generated today, don't regenerate
  if (lastGeneratedDate === today) {
    return false;
  }

  // If it's a new day and after 4 AM, generate
  return currentHour >= 4;
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
  const [isMirrorCollapsed, setIsMirrorCollapsed] = useState(true);
  const [bottleneck, setBottleneck] = useState<string | null>(null);
  const [showBottleneckBanner, setShowBottleneckBanner] = useState(true);
  // commitmentMap: keyed by thought_id for O(1) lookups in render
  const [commitmentMap, setCommitmentMap] = useState<Record<string, Commitment>>({});
  const [gateVisible, setGateVisible] = useState(false);
  const [gateCountdown, setGateCountdown] = useState(3);
  const [gateOpenCount, setGateOpenCount] = useState(0);
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
        .filter(e => !/^app deployment success$/i.test((e.title || '').trim()))
        .slice(-1)[0]; // Get the oldest (last in desc order)
      if (oldestMomentum) {
        setBottleneck(oldestMomentum.title);
        setShowBottleneckBanner(true);
      } else {
        setBottleneck(null);
      }

      // Morning Mirror: Daily synthesis of YESTERDAY's vents
      // Only generates once per day, on first app open after 4 AM
      const [storedMirror, storedSourceDate, storedGeneratedDate] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.MORNING_MIRROR),
        AsyncStorage.getItem(STORAGE_KEYS.MORNING_MIRROR_DATE),
        AsyncStorage.getItem(STORAGE_KEYS.MORNING_MIRROR_GENERATED),
      ]);

      // Check if we should generate a new mirror
      if (shouldGenerateMirror(storedGeneratedDate)) {
        // Fetch yesterday's vents for synthesis
        const yesterdaysVents = await fetchYesterdaysVents();
        const yesterday = getYesterdayDateString();

        if (yesterdaysVents.length > 0) {
          setIsLoadingMirror(true);
          try {
            const ventContents = yesterdaysVents
              .filter(v => v.content)
              .map(v => ({ content: v.content || '', created_at: v.created_at }));
            const mirror = await generateDailyMirror(ventContents);

            // Store the mirror with today's generation date
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
        } else {
          // No vents yesterday - clear the mirror
          await Promise.all([
            AsyncStorage.removeItem(STORAGE_KEYS.MORNING_MIRROR),
            AsyncStorage.removeItem(STORAGE_KEYS.MORNING_MIRROR_DATE),
            AsyncStorage.setItem(STORAGE_KEYS.MORNING_MIRROR_GENERATED, getTodayDateString()),
          ]);
          setMorningMirror(null);
          setMirrorSourceDate(null);
        }
      } else if (storedMirror && storedSourceDate) {
        // Use the cached mirror (already generated today)
        setMorningMirror(storedMirror);
        setMirrorSourceDate(storedSourceDate);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    await beginRecording();
  };

  const handlePressIn = async () => {
    if (isProcessing || gateVisible || isRecording) {
      return;
    }

    const openCommitments = Object.values(commitmentMap).filter(c => c.status === 'open').length;

    if (openCommitments > 3) {
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
          newAnimatedEntries.push({
            ...savedEntry,
            glowAnim: new Animated.Value(0),
            slideAnim: new Animated.Value(0),
          });
        }
      }

      if (newAnimatedEntries.length > 0) {
        setEntries((prev) => [...newAnimatedEntries, ...prev]);
        animateNewItems(newAnimatedEntries);

        const newAnimal = await getTodaysSpiritAnimal();
        setSpiritAnimal(newAnimal);

        // Note: Today's vents are saved for tomorrow's Morning Mirror
        // The mirror is locked after first generation each day
      }

      setStatusText(`Added ${newAnimatedEntries.length} item${newAnimatedEntries.length > 1 ? 's' : ''}`);
      setTimeout(() => setStatusText('Hold to record'), 2000);
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

  const visibleEntries = entries.filter(
    (entry) => !/^app deployment success$/i.test((entry.title || '').trim())
  );

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
                <Text style={{
                  marginTop: 30,
                  color: '#444444',
                  fontSize: 13,
                  textAlign: 'center',
                  fontStyle: 'italic'
                }}>
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
                <Text style={styles.gatePrimaryButtonText}>Record anyway</Text>
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

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <Text style={styles.header}>Renaissance</Text>
      <Text style={styles.versionBadge}>v{APP_VERSION} · {APP_RUNTIME}</Text>

      {/* Spirit Animal */}
      <View style={styles.spiritAnimalContainer}>
        <Text style={styles.spiritAnimalLabel}>Spirit Animal</Text>
        <Text style={styles.spiritAnimal}>{spiritAnimal}</Text>
      </View>

      {/* Accountability Banner - Bottleneck Detector */}
      {showBottleneckBanner && bottleneck && (
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

      {/* Fixed Header Area - Filter Bar + Morning Mirror */}
      <View style={styles.fixedHeader}>
        {/* Category Filter Bar */}
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
                    Your synthesis from {formatDateForDisplay(mirrorSourceDate)}
                  </Text>
                )}
                {isLoadingMirror && (
                  <Text style={styles.morningMirrorSubtitle}>Synthesizing yesterday...</Text>
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

      {/* Entry List - Fills remaining space */}
      <View style={styles.entryListContainer}>
        <Text style={styles.entryListHeader}>
          {activeFilter
            ? `${TYPE_LABELS[activeFilter] || activeFilter} (${visibleEntries.filter(e => e.type === activeFilter).length})`
            : visibleEntries.length > 0
              ? `Brain Dump (${visibleEntries.length})`
              : 'Your thoughts will appear here'}
        </Text>
        <FlatList
          data={activeFilter ? visibleEntries.filter(e => e.type === activeFilter) : visibleEntries}
          renderItem={renderEntry}
          keyExtractor={(item) => item.id}
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
      </View>

      {/* Detail Modal */}
      {renderDetailModal()}

      {/* Gate #2 */}
      {renderCommitmentGate()}
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
  spiritAnimalContainer: {
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 255, 0.1)',
  },
  spiritAnimalLabel: {
    fontSize: 10,
    color: '#666666',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 4,
  },
  spiritAnimal: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
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
    maxHeight: 200,
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
  entryList: {
    flex: 1,
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
    padding: 14,
    backgroundColor: 'rgba(255, 107, 107, 0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.12)',
  },
  morningMirrorCardCollapsed: {
    padding: 10,
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
    fontSize: 10,
    marginTop: 1,
    fontStyle: 'italic',
  },
  morningMirrorChevron: {
    color: '#FF6B6B',
    fontSize: 10,
    opacity: 0.6,
  },
  morningMirrorSynthesis: {
    // Philosophy Style - readable but compact
    color: '#DDDDDD',
    fontSize: 15,
    lineHeight: 24,
    fontStyle: 'italic',
    letterSpacing: 0.3,
    textAlign: 'center',
    marginTop: 10,
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
    color: '#555555',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 18,
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
});
