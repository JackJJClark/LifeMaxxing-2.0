import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import StatusScreen from './src/screens/StatusScreen';

export default function App() {
  return (
    <View style={styles.container}>
      <StatusScreen />
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1115',
  },
});
