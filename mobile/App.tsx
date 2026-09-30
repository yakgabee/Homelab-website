import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { streamChat, type ChatMessage } from './src/ollama';
import { SettingsSheet } from './src/SettingsSheet';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './src/settings';
import { useTheme } from './src/theme';

interface Message extends ChatMessage {
  id: string;
  error?: boolean;
}

let nextId = 0;
const newId = () => String(++nextId);

export default function App() {
  return (
    <SafeAreaProvider>
      <Chat />
    </SafeAreaProvider>
  );
}

function Chat() {
  const t = useTheme();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
      if (!s.serverUrl || !s.model) setShowSettings(true);
    });
  }, []);

  const ready = Boolean(settings.serverUrl && settings.model);

  async function send() {
    const text = input.trim();
    if (!text || busy || !ready) return;

    const userMsg: Message = { id: newId(), role: 'user', content: text };
    const replyId = newId();
    const history = [...messages.filter((m) => !m.error), userMsg];
    setMessages([...messages, userMsg, { id: replyId, role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const appendToReply = (patch: (m: Message) => Message) =>
      setMessages((all) => all.map((m) => (m.id === replyId ? patch(m) : m)));

    try {
      const payload: ChatMessage[] = [
        ...(settings.systemPrompt.trim() ? [{ role: 'system' as const, content: settings.systemPrompt }] : []),
        ...history.map(({ role, content }) => ({ role, content })),
      ];
      await streamChat({
        baseUrl: settings.serverUrl,
        model: settings.model,
        messages: payload,
        signal: controller.signal,
        onToken: (token) => appendToReply((m) => ({ ...m, content: m.content + token })),
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        appendToReply((m) => ({
          ...m,
          error: true,
          content: m.content ? `${m.content}\n\n⚠️ ${message}` : `⚠️ ${message}`,
        }));
      }
    } finally {
      // Drop an empty reply if the user stopped it before any text arrived.
      setMessages((all) => all.filter((m) => m.id !== replyId || m.content));
      abortRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function newChat() {
    stop();
    setMessages([]);
  }

  async function onSaveSettings(next: Settings) {
    setSettings(next);
    setShowSettings(false);
    await saveSettings(next);
  }

  if (!loaded) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <StatusBar style="auto" />

      <View style={[styles.header, { borderColor: t.border, backgroundColor: t.card }]}>
        <Pressable onPress={newChat} hitSlop={12} disabled={messages.length === 0}>
          <Text style={{ color: messages.length ? t.accent : t.muted, fontSize: 16 }}>New</Text>
        </Pressable>
        <Pressable style={styles.headerTitle} onPress={() => setShowSettings(true)}>
          <Text style={[styles.title, { color: t.text }]}>Pi AI</Text>
          <Text style={[styles.subtitle, { color: t.muted }]} numberOfLines={1}>
            {ready ? settings.model : 'Not connected'}
          </Text>
        </Pressable>
        <Pressable onPress={() => setShowSettings(true)} hitSlop={12}>
          <Text style={{ color: t.accent, fontSize: 16 }}>Settings</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          keyboardDismissMode="interactive"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: t.text }]}>
                {ready ? 'Ask me anything' : 'Connect to your Pi'}
              </Text>
              <Text style={[styles.emptyText, { color: t.muted }]}>
                {ready
                  ? 'Everything runs on your own server. Nothing leaves your network.'
                  : 'Tap Settings and enter your Ollama server address.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => <Bubble message={item} thinking={busy && !item.content} />}
        />

        <View style={[styles.composer, { borderColor: t.border, backgroundColor: t.card }]}>
          <TextInput
            style={[styles.input, { color: t.text, backgroundColor: t.bg, borderColor: t.border }]}
            value={input}
            onChangeText={setInput}
            placeholder={ready ? 'Message' : 'Set up a server first'}
            placeholderTextColor={t.muted}
            editable={ready}
            multiline
          />
          {busy ? (
            <Pressable onPress={stop} style={[styles.send, { backgroundColor: t.text }]}>
              <View style={[styles.stopIcon, { backgroundColor: t.bg }]} />
            </Pressable>
          ) : (
            <Pressable
              onPress={send}
              disabled={!input.trim() || !ready}
              style={[styles.send, { backgroundColor: t.accent, opacity: input.trim() && ready ? 1 : 0.4 }]}
            >
              <Text style={[styles.sendArrow, { color: t.onAccent }]}>↑</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      {showSettings && (
        <SettingsSheet
          settings={settings}
          onSave={onSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </SafeAreaView>
  );
}

function Bubble({ message, thinking }: { message: Message; thinking: boolean }) {
  const t = useTheme();
  const mine = message.role === 'user';
  return (
    <View
      style={[
        styles.bubble,
        mine
          ? { alignSelf: 'flex-end', backgroundColor: t.userBubble }
          : { alignSelf: 'flex-start', backgroundColor: t.botBubble, borderColor: t.border, borderWidth: 1 },
      ]}
    >
      {thinking ? (
        <ActivityIndicator color={t.muted} />
      ) : (
        <Text
          selectable
          style={[styles.bubbleText, { color: mine ? t.userText : message.error ? t.bad : t.text }]}
        >
          {message.content}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { alignItems: 'center', flex: 1, marginHorizontal: 12 },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 1 },
  list: { padding: 12, gap: 8, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '600', marginBottom: 6 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  bubble: { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    maxHeight: 140,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendArrow: { fontSize: 20, fontWeight: '700' },
  stopIcon: { width: 14, height: 14, borderRadius: 3 },
});
