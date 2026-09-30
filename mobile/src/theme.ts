import { useColorScheme } from 'react-native';

const light = {
  bg: '#f4f5f7',
  card: '#ffffff',
  text: '#1d2330',
  muted: '#6b7280',
  border: '#e3e6eb',
  accent: '#c51a4a',
  onAccent: '#ffffff',
  userBubble: '#c51a4a',
  userText: '#ffffff',
  botBubble: '#ffffff',
  ok: '#1f9d55',
  bad: '#dc2626',
};

const dark: typeof light = {
  bg: '#0f1216',
  card: '#171b21',
  text: '#e6e8eb',
  muted: '#8b93a1',
  border: '#262c35',
  accent: '#e0457a',
  onAccent: '#ffffff',
  userBubble: '#b8325f',
  userText: '#ffffff',
  botBubble: '#1d2229',
  ok: '#34c77b',
  bad: '#f05252',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
