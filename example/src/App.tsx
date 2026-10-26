import { useCallback, useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import IconSwitcher, {
  IconSwitcherError,
  type IconName,
} from 'react-native-icon-switcher';

function _formatError(error: unknown): string {
  if (error instanceof IconSwitcherError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default function App() {
  const [current, setCurrent] = useState<string>('…');
  const [lastStatus, setLastStatus] = useState<string>('—');
  const iconNames = IconSwitcher.list().filter((name) => name !== 'default');

  const refreshCurrent = useCallback(async () => {
    try {
      const name = await IconSwitcher.getCurrent();
      setCurrent(name);
    } catch (error) {
      setCurrent(_formatError(error));
    }
  }, []);

  useEffect(() => {
    void refreshCurrent();
  }, [refreshCurrent]);

  const onSet = async (name: IconName) => {
    try {
      const result = await IconSwitcher.set(name);
      setLastStatus(JSON.stringify(result));
      await refreshCurrent();
    } catch (error) {
      setLastStatus(_formatError(error));
    }
  };

  const onReset = async () => {
    try {
      const result = await IconSwitcher.reset();
      setLastStatus(JSON.stringify(result));
      await refreshCurrent();
    } catch (error) {
      setLastStatus(_formatError(error));
    }
  };

  const onApplyPending = async () => {
    try {
      const result = await IconSwitcher.applyPending();
      setLastStatus(JSON.stringify(result));
    } catch (error) {
      setLastStatus(_formatError(error));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>react-native-icon-switcher (Expo)</Text>
      <Text>isSupported: {String(IconSwitcher.isSupported)}</Text>
      <Text>list(): {IconSwitcher.list().join(', ')}</Text>
      <Text testID="current-icon">current: {current}</Text>
      <Text testID="last-status">last: {lastStatus}</Text>

      {iconNames.map((name) => (
        <Button
          key={name}
          testID={`icon-${name}`}
          title={`Set ${name}`}
          onPress={() => void onSet(name)}
        />
      ))}

      <View style={styles.spacer} />
      <Button
        testID="icon-reset"
        title="Reset (default)"
        onPress={() => void onReset()}
      />
      <Button
        testID="apply-pending"
        title="Apply pending"
        onPress={() => void onApplyPending()}
      />

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 64,
    gap: 8,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  spacer: {
    height: 16,
  },
});
