export const herculesTheme = {
  colors: {
    background: '#06110f',
    backgroundElevated: '#0d1b18',
    panel: '#122521',
    panelMuted: '#0b1715',
    border: 'rgba(163, 255, 227, 0.18)',
    text: '#f5fff9',
    textMuted: '#9fc1b6',
    textDim: '#6c8b83',
    accent: '#7dffcf',
    accentStrong: '#35e0a1',
    danger: '#ff7b6b',
    warning: '#ffd166',
    timer: '#8ae1ff',
    effortHigh: '#ff8a65',
    effortMedium: '#ffd166',
    effortLow: '#7dffcf',
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    sm: 12,
    md: 20,
    lg: 28,
    pill: 999,
  },
  typography: {
    eyebrow: 11,
    label: 13,
    body: 15,
    title: 28,
    metric: 42,
  },
} as const;

export type HerculesTheme = typeof herculesTheme;
