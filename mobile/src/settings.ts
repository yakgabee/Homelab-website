import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  serverUrl: string;
  model: string;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: '',
  model: '',
  systemPrompt: 'You are a helpful assistant. Keep answers short and clear.',
};

const KEY = 'settings.v1';

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
