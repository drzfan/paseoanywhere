import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>paseoanywhere</Text>
      <Text style={styles.subtitle}>voice-first thin client for paseo</Text>
      <Text style={styles.phase}>P1 scaffold — UI lands in later phases</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  phase: {
    fontSize: 12,
    opacity: 0.5,
  },
});
