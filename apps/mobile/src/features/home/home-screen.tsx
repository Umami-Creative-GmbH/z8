import { Button, Column, Host, Row, Text } from "@expo/ui";
import { StyleSheet } from "react-native";

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
    <Host style={styles.container}>
      <Column spacing={16}>
        <Column spacing={14} style={styles.primarySurface}>
          <Text textStyle={styles.eyebrowText}>Today</Text>
          <Text textStyle={styles.titleText}>{isClockedIn ? "You are clocked in" : "Ready to start work"}</Text>
          <Text textStyle={styles.descriptionText}>
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

          {errorMessage ? <Text textStyle={styles.errorMessageText}>{errorMessage}</Text> : null}

          <Button
            label={actionLabel}
            disabled={isClockedIn ? isSubmitting : isClockInDisabled}
            onPress={isClockedIn ? onClockOut : onClockIn}
          />
        </Column>

        <Column spacing={12} style={styles.summarySurface}>
          <Text textStyle={styles.summaryTitleText}>Today summary</Text>
          <Row spacing={12}>
            <Text textStyle={styles.summaryLabelText}>Minutes worked</Text>
            <Text textStyle={styles.summaryValueText}>{String(today.minutesWorked)}</Text>
          </Row>
          <Row spacing={12}>
            <Text textStyle={styles.summaryLabelText}>Latest event</Text>
            <Text textStyle={styles.summaryValueText}>{today.latestEventLabel ?? "No events yet"}</Text>
          </Row>
        </Column>
      </Column>
    </Host>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  primarySurface: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#ffffff",
  },
  eyebrowText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
    color: "#2563eb",
    textTransform: "uppercase",
  },
  titleText: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "700",
    color: "#0f172a",
  },
  descriptionText: {
    fontSize: 15,
    lineHeight: 22,
    color: "#475569",
  },
  errorMessageText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#b91c1c",
  },
  summarySurface: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  summaryTitleText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  summaryLabelText: {
    fontSize: 14,
    color: "#475569",
  },
  summaryValueText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
});
