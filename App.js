import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { PostHogProvider } from 'posthog-react-native';
import StatusScreen from './src/screens/StatusScreen';
import {
  POSTHOG_API_KEY,
  POSTHOG_HOST,
  SENTRY_DSN,
  SENTRY_TRACES_SAMPLE_RATE,
} from './src/config';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: Number.isFinite(SENTRY_TRACES_SAMPLE_RATE)
      ? SENTRY_TRACES_SAMPLE_RATE
      : 0,
  });
}

function AppContent() {
  return (
    <View style={styles.container}>
      <StatusScreen />
      <StatusBar style="light" />
    </View>
  );
}

export default function App() {
  if (POSTHOG_API_KEY) {
    return (
      <PostHogProvider
        apiKey={POSTHOG_API_KEY}
        options={{ host: POSTHOG_HOST || 'https://us.i.posthog.com' }}
      >
        <AppContent />
      </PostHogProvider>
    );
  }
  return <AppContent />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1115',
  },
});
