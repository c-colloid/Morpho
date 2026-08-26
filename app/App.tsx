import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import EditorScreen from './src/ui/EditorScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="dark" />
        {/* SafeAreaView で包むと計測が絡んで縦位置が崩れることがあったため、
            余白は EditorScreen 側で useSafeAreaInsets から自前で当てる */}
        <EditorScreen />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E6E8EC' },
});
