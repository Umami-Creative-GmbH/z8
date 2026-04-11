import { Pressable, StyleSheet, Text, View } from "react-native";

interface MobileSessionErrorStateProps {
  onRetry: () => void;
}

export function MobileSessionErrorState({ onRetry }: MobileSessionErrorStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Session unavailable</Text>
      <Text style={styles.subtitle}>Check your connection and try again.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
        <Text style={styles.buttonLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#f8fafc",
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0f172a",
  },
  subtitle: {
    marginTop: 8,
    textAlign: "center",
    color: "#475569",
  },
  button: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563eb",
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
