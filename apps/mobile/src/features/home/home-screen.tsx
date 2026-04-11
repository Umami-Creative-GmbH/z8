import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileHomeData, WorkLocationType } from "./use-home-query";
import { WorkLocationPicker } from "./work-location-picker";

interface HomeScreenProps {
  clock: MobileHomeData["clock"];
  today: MobileHomeData["today"];
  selectedWorkLocation: WorkLocationType | null;
  isSubmitting: boolean;
  errorMessage?: string | null;
  onSelectWorkLocation: (location: WorkLocationType) => void;
  onClockIn: () => void;
  onClockOut: () => void;
}

export function HomeScreen({
  clock,
  today,
  selectedWorkLocation,
  isSubmitting,
  errorMessage,
  onSelectWorkLocation,
  onClockIn,
  onClockOut,
}: HomeScreenProps) {
  const isClockedIn = clock.isClockedIn;
  const isClockInDisabled = !selectedWorkLocation || isSubmitting;
  const actionLabel = isSubmitting
    ? isClockedIn
      ? "Clocking Out…"
      : "Clocking In…"
    : isClockedIn
      ? "Clock Out"
      : "Clock In";

  return (
    <View style={styles.container}>
      <View style={styles.primarySurface}>
        <Text style={styles.eyebrow}>Today</Text>
        <Text style={styles.title}>{isClockedIn ? "You are clocked in" : "Ready to start work"}</Text>
        <Text style={styles.description}>
          {isClockedIn
            ? "End the current work period when you are done."
            : "Select where you are working before clocking in."}
        </Text>

        {!isClockedIn ? (
          <WorkLocationPicker
            disabled={isSubmitting}
            onChange={onSelectWorkLocation}
            selectedValue={selectedWorkLocation}
          />
        ) : null}

        {errorMessage ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorMessage}>
            {errorMessage}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={isClockedIn ? isSubmitting : isClockInDisabled}
          onPress={
            isClockedIn
              ? onClockOut
              : isClockInDisabled
                ? undefined
                : onClockIn
          }
          style={[
            styles.primaryAction,
            (isClockedIn ? isSubmitting : isClockInDisabled) && styles.primaryActionDisabled,
          ]}
        >
          <Text style={styles.primaryActionLabel}>{actionLabel}</Text>
        </Pressable>
      </View>

      <View style={styles.summarySurface}>
        <Text style={styles.summaryTitle}>Today summary</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Minutes worked</Text>
          <Text style={styles.summaryValue}>{today.minutesWorked}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Latest event</Text>
          <Text style={styles.summaryValue}>{today.latestEventLabel ?? "No events yet"}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 16,
    backgroundColor: "#f8fafc",
  },
  primarySurface: {
    padding: 18,
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#ffffff",
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
    color: "#2563eb",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "700",
    color: "#0f172a",
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: "#475569",
  },
  errorMessage: {
    fontSize: 13,
    lineHeight: 18,
    color: "#b91c1c",
  },
  primaryAction: {
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563eb",
    alignItems: "center",
  },
  primaryActionDisabled: {
    opacity: 0.55,
  },
  primaryActionLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  summarySurface: {
    padding: 18,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: "#475569",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
});
