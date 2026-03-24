import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { herculesTheme } from '../theme';

interface HerculesActionButtonProps {
  label: string;
  hint: string;
  pulseAnim: Animated.Value;
  haloAnim?: Animated.Value;
  isRecording?: boolean;
  isProcessing?: boolean;
  onPressIn?: () => void;
  onPressOut?: () => void;
}

export function HerculesActionButton({
  label,
  hint,
  pulseAnim,
  haloAnim,
  isRecording = false,
  isProcessing = false,
  onPressIn,
  onPressOut,
}: HerculesActionButtonProps) {
  const resolvedHaloAnim = haloAnim || pulseAnim;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          transform: [{ scale: pulseAnim }],
          shadowOpacity: resolvedHaloAnim,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.outerHalo,
          {
            opacity: resolvedHaloAnim,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[
          styles.button,
          isRecording && styles.buttonRecording,
          isProcessing && styles.buttonProcessing,
        ]}
      >
        <View
          style={[
            styles.outerRing,
            isRecording && styles.outerRingRecording,
            isProcessing && styles.outerRingProcessing,
          ]}
        >
          <View
            style={[
              styles.middleRing,
              isRecording && styles.middleRingRecording,
              isProcessing && styles.middleRingProcessing,
            ]}
          >
            <View
              style={[
                styles.innerCore,
                isRecording && styles.innerCoreRecording,
                isProcessing && styles.innerCoreProcessing,
              ]}
            >
              <Text style={styles.iconText}>{isRecording ? '●' : '◉'}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'center',
    shadowColor: herculesTheme.colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 34,
  },
  outerHalo: {
    position: 'absolute',
    top: -22,
    left: -22,
    right: -22,
    bottom: -22,
    borderRadius: 999,
    backgroundColor: 'rgba(125, 255, 207, 0.12)',
  },
  button: {
    width: 208,
    height: 208,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: herculesTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: herculesTheme.colors.accent,
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
    shadowOpacity: 1,
    shadowRadius: 28,
  },
  outerRing: {
    width: 152,
    height: 152,
    borderRadius: 76,
    borderWidth: 2,
    borderColor: 'rgba(125, 255, 207, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRingRecording: {
    borderColor: 'rgba(255, 59, 48, 0.6)',
  },
  outerRingProcessing: {
    borderColor: 'rgba(125, 255, 207, 0.6)',
  },
  middleRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: herculesTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middleRingRecording: {
    borderColor: '#FF3B30',
  },
  middleRingProcessing: {
    borderColor: herculesTheme.colors.accent,
  },
  innerCore: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: herculesTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: herculesTheme.colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 24,
  },
  innerCoreRecording: {
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
  },
  innerCoreProcessing: {
    shadowRadius: 30,
  },
  iconText: {
    color: '#000000',
    fontSize: 28,
    fontWeight: '700',
  },
});
