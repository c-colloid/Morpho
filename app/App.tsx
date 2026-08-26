import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import EditorScreen from './src/ui/EditorScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="dark" />
        {/* 横向きの iPad ではホームインジケータと角丸が左右から食い込む */}
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <EditorScreen />
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E6E8EC' },
  safe: { flex: 1 },
});
