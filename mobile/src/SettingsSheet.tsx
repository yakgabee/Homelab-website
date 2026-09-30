import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatSize, listModels, normaliseUrl, type OllamaModel } from './ollama';
import type { Settings } from './settings';
import { useTheme } from './theme';

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; models: OllamaModel[] }
  | { kind: 'error'; message: string };

async function checkServer(serverUrl: string): Promise<Status> {
  try {
    return { kind: 'ok', models: await listModels(serverUrl) };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Keeps the chosen model if the server has it, otherwise picks the first one. */
function withValidModel(settings: Settings, status: Status): Settings {
  if (status.kind !== 'ok' || status.models.some((m) => m.name === settings.model)) return settings;
  return { ...settings, model: status.models[0]?.name ?? '' };
}

/** Mount this only while it should be shown; it starts from the saved settings each time. */
export function SettingsSheet(props: {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const initialUrl = props.settings.serverUrl;
  const [draft, setDraft] = useState(props.settings);
  const [status, setStatus] = useState<Status>(initialUrl ? { kind: 'testing' } : { kind: 'idle' });

  // Re-check the saved server as soon as the sheet opens.
  useEffect(() => {
    if (!initialUrl) return;
    let cancelled = false;
    checkServer(initialUrl).then((result) => {
      if (cancelled) return;
      setStatus(result);
      setDraft((d) => withValidModel(d, result));
    });
    return () => {
      cancelled = true;
    };
  }, [initialUrl]);

  async function testConnection() {
    const serverUrl = normaliseUrl(draft.serverUrl);
    if (!serverUrl) return;
    setDraft((d) => ({ ...d, serverUrl }));
    setStatus({ kind: 'testing' });
    const result = await checkServer(serverUrl);
    setStatus(result);
    setDraft((d) => withValidModel(d, result));
  }

  const input = [styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <SafeAreaView style={[styles.fill, { backgroundColor: t.card }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderColor: t.border }]}>
          <Pressable onPress={props.onClose} hitSlop={12}>
            <Text style={{ color: t.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: t.text }]}>Settings</Text>
          <Pressable
            onPress={() => props.onSave({ ...draft, serverUrl: normaliseUrl(draft.serverUrl) })}
            hitSlop={12}
          >
            <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600' }}>Save</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: t.muted }]}>OLLAMA SERVER</Text>
          <TextInput
            style={input}
            value={draft.serverUrl}
            onChangeText={(serverUrl) => setDraft({ ...draft, serverUrl })}
            onSubmitEditing={() => testConnection()}
            placeholder="http://10.0.10.144:11434"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
          />
          <Text style={[styles.hint, { color: t.muted }]}>
            Your Pi’s home IP works on Wi-Fi. Its Tailscale IP (100.x.x.x) works from anywhere.
          </Text>

          <Pressable
            onPress={() => testConnection()}
            style={[styles.button, { backgroundColor: t.accent }]}
            disabled={status.kind === 'testing'}
          >
            {status.kind === 'testing' ? (
              <ActivityIndicator color={t.onAccent} />
            ) : (
              <Text style={[styles.buttonText, { color: t.onAccent }]}>Test connection</Text>
            )}
          </Pressable>

          {status.kind === 'error' && (
            <Text style={[styles.status, { color: t.bad }]}>Couldn’t connect: {status.message}</Text>
          )}
          {status.kind === 'ok' && (
            <Text style={[styles.status, { color: t.ok }]}>
              Connected · {status.models.length} model{status.models.length === 1 ? '' : 's'} installed
            </Text>
          )}

          {status.kind === 'ok' && (
            <>
              <Text style={[styles.label, { color: t.muted }]}>MODEL</Text>
              {status.models.length === 0 && (
                <Text style={[styles.hint, { color: t.muted }]}>
                  No models yet. On the Pi, run: ollama pull llama3.2:1b
                </Text>
              )}
              {status.models.map((m) => {
                const selected = m.name === draft.model;
                return (
                  <Pressable
                    key={m.name}
                    onPress={() => setDraft({ ...draft, model: m.name })}
                    style={[
                      styles.model,
                      { borderColor: selected ? t.accent : t.border, backgroundColor: t.bg },
                    ]}
                  >
                    <Text style={{ color: t.text, fontWeight: '600' }}>{m.name}</Text>
                    <Text style={{ color: t.muted, fontSize: 13 }}>
                      {[m.details?.parameter_size, formatSize(m.size)].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          )}

          <Text style={[styles.label, { color: t.muted }]}>PERSONALITY (SYSTEM PROMPT)</Text>
          <TextInput
            style={[input, styles.multiline]}
            value={draft.systemPrompt}
            onChangeText={(systemPrompt) => setDraft({ ...draft, systemPrompt })}
            placeholder="Optional instructions for the AI"
            placeholderTextColor={t.muted}
            multiline
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '600' },
  body: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  hint: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  status: { marginTop: 10, fontSize: 14 },
  model: { borderWidth: 1.5, borderRadius: 10, padding: 12, marginBottom: 8, gap: 2 },
});
