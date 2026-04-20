import * as Updates from 'expo-updates';

const inlinePublicEnv: Record<string, string> = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '',
};

const getExpoExtra = (): Record<string, unknown> => {
  const manifestExtra = (Updates.manifest as { extra?: Record<string, unknown> } | null)?.extra;
  if (manifestExtra && typeof manifestExtra === 'object') {
    const extraRecord = manifestExtra as Record<string, unknown>;
    const expoClientExtra = extraRecord.expoClient;

    if (expoClientExtra && typeof expoClientExtra === 'object') {
      return {
        ...extraRecord,
        ...(expoClientExtra as Record<string, unknown>),
      };
    }

    return extraRecord;
  }

  return {};
};

const readEnv = (key: string): string | undefined => {
  const processValue = inlinePublicEnv[key];
  if (processValue) {
    return processValue;
  }

  const extraValue = getExpoExtra()[key];
  if (typeof extraValue !== 'string') {
    return undefined;
  }

  const trimmed = extraValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getMissingPublicEnv = () => (
  ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'].filter((key) => !readEnv(key))
);

export const getPublicEnvError = () => {
  const missing = getMissingPublicEnv();
  if (missing.length === 0) {
    return null;
  }

  return `Missing required runtime config: ${missing.join(', ')}. Rebuild the app with these EXPO_PUBLIC_* values set in EAS.`;
};

const requireEnv = (key: string): string => {
  const value = readEnv(key);
  if (!value) {
    throw new Error(getPublicEnvError() || `Missing required environment variable: ${key}.`);
  }
  return value;
};

export const env = {
  get supabaseUrl() {
    return requireEnv('EXPO_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  },
};

export const getSupabaseFunctionUrl = (functionName: string) => (
  `${env.supabaseUrl.replace(/\/+$/, '')}/functions/v1/${functionName}`
);
