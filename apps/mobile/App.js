import { useState } from "react";
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Folo-Style Expo Demo</Text>
        <Text style={styles.meta}>Platform: mobile (expo)</Text>
        <Pressable style={styles.button} onPress={() => setCount((v) => v + 1)}>
          <Text style={styles.buttonText}>Tap me</Text>
        </Pressable>
        <Text style={styles.counter}>Taps: {count}</Text>
      </View>
      <StatusBar barStyle="dark-content" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#eef2f8",
    alignItems: "center",
    justifyContent: "center"
  },
  card: {
    width: "86%",
    borderRadius: 16,
    padding: 24,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d6dfec"
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 8,
    color: "#111827"
  },
  meta: {
    color: "#334155",
    marginBottom: 16
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: "#0f766e",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600"
  },
  counter: {
    marginTop: 14,
    fontSize: 18,
    color: "#1f2937"
  }
});
