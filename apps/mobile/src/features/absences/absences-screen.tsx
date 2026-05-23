import { Button, Column, Host, List, ListItem, Row, Text } from "@expo/ui";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { Alert, StyleSheet, Text as NativeText } from "react-native";

import type { MobileAbsenceRecord } from "./use-absences-query";

type AbsenceFilter = "upcoming" | "pending" | "past";

interface AbsencesScreenProps {
  absences: MobileAbsenceRecord[];
  isLoading: boolean;
  errorMessage?: string | null;
  onRequestAbsence: () => void;
  onCancelAbsence: (absenceId: string) => void;
  isCancellingAbsence: boolean;
  cancellingAbsenceId?: string | null;
}

const FILTER_OPTIONS: Array<{ value: AbsenceFilter; label: string }> = [
  { value: "upcoming", label: "Upcoming" },
  { value: "pending", label: "Pending" },
  { value: "past", label: "Past" },
];

export function AbsencesScreen({
  absences,
  isLoading,
  errorMessage,
  onRequestAbsence,
  onCancelAbsence,
  isCancellingAbsence,
  cancellingAbsenceId,
}: AbsencesScreenProps) {
  const [activeFilter, setActiveFilter] = useState<AbsenceFilter>("upcoming");
  const filteredAbsences = useMemo(() => filterAbsences(absences, activeFilter), [absences, activeFilter]);

  function handleCancelAbsence(absenceId: string, categoryName: string) {
    Alert.alert("Cancel request?", `Cancel your ${categoryName} absence request?`, [
      {
        text: "Keep request",
        style: "cancel",
      },
      {
        text: "Cancel request",
        style: "destructive",
        onPress: () => onCancelAbsence(absenceId),
      },
    ]);
  }

  return (
    <Host style={styles.container}>
      <Column spacing={16}>
        <Column spacing={12} style={styles.headerSurface}>
          <Text textStyle={styles.eyebrowText}>Absences</Text>
          <Text textStyle={styles.titleText}>Track your requests and upcoming time off</Text>
          <Text textStyle={styles.descriptionText}>
            Keep upcoming absences visible and cancel pending requests when plans change.
          </Text>

          <Button label="Request Absence" onPress={onRequestAbsence} />
        </Column>

        <Column spacing={14} style={styles.listSurface}>
          <Row spacing={8}>
            {FILTER_OPTIONS.map((option) => {
              const isActive = option.value === activeFilter;

              return (
                <Button
                  key={option.value}
                  label={option.label}
                  onPress={() => setActiveFilter(option.value)}
                  variant={isActive ? "filled" : "outlined"}
                />
              );
            })}
          </Row>

          {errorMessage ? (
            <NativeText accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorMessageText}>
              {errorMessage}
            </NativeText>
          ) : null}

          {isLoading ? (
            <Text textStyle={styles.emptyStateText}>Loading absences…</Text>
          ) : filteredAbsences.length === 0 ? (
            <Text textStyle={styles.emptyStateText}>{getEmptyStateLabel(activeFilter)}</Text>
          ) : (
            <List>
              {filteredAbsences.map((absence) => {
                const isPending = absence.status === "pending";
                const isCancellingCurrent = cancellingAbsenceId === absence.id && isCancellingAbsence;

                return (
                  <Column key={absence.id} spacing={6} style={styles.rowSurface}>
                    <ListItem
                      supportingText={formatDateRange(absence)}
                      trailing={<Text>{formatStatus(absence.status)}</Text>}
                    >
                      {absence.category.name}
                    </ListItem>
                    {absence.notes ? <Text textStyle={styles.notesText}>{absence.notes}</Text> : null}
                    {isPending ? (
                      <Button
                        disabled={isCancellingAbsence}
                        label={isCancellingCurrent ? "Cancelling…" : "Cancel Request"}
                        onPress={() => handleCancelAbsence(absence.id, absence.category.name)}
                        variant="outlined"
                      />
                    ) : null}
                  </Column>
                );
              })}
            </List>
          )}
        </Column>
      </Column>
    </Host>
  );
}

function filterAbsences(absences: MobileAbsenceRecord[], filter: AbsenceFilter) {
  const today = DateTime.now().startOf("day");

  return [...absences]
    .filter((absence) => {
      const endDate = DateTime.fromISO(absence.endDate);

      if (filter === "pending") {
        return absence.status === "pending";
      }

      if (filter === "past") {
        return absence.status !== "pending" && endDate < today;
      }

      return absence.status !== "rejected" && absence.status !== "cancelled" && endDate >= today;
    })
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
}

function formatDateRange(absence: MobileAbsenceRecord) {
  const start = DateTime.fromISO(absence.startDate);
  const end = DateTime.fromISO(absence.endDate);
  const startLabel = `${start.toLocaleString(DateTime.DATE_MED)} ${formatPeriod(absence.startPeriod)}`;
  const endLabel = `${end.toLocaleString(DateTime.DATE_MED)} ${formatPeriod(absence.endPeriod)}`;

  if (absence.startDate === absence.endDate && absence.startPeriod === absence.endPeriod) {
    return startLabel;
  }

  return `${startLabel} to ${endLabel}`;
}

function formatPeriod(period: MobileAbsenceRecord["startPeriod"]) {
  if (period === "am") {
    return "AM";
  }

  if (period === "pm") {
    return "PM";
  }

  return "Full day";
}

function formatStatus(status: MobileAbsenceRecord["status"]) {
  if (status === "pending") {
    return "Pending";
  }

  if (status === "approved") {
    return "Approved";
  }

  if (status === "rejected") {
    return "Rejected";
  }

  return "Cancelled";
}

function getEmptyStateLabel(filter: AbsenceFilter) {
  if (filter === "pending") {
    return "No pending requests";
  }

  if (filter === "past") {
    return "No past absences yet";
  }

  return "No upcoming absences";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  headerSurface: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbe2f0",
    backgroundColor: "#ffffff",
  },
  eyebrowText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
    color: "#3730a3",
    textTransform: "uppercase",
  },
  titleText: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "700",
    color: "#0f172a",
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 21,
    color: "#475569",
  },
  listSurface: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbe2f0",
    backgroundColor: "#ffffff",
  },
  errorMessageText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#b91c1c",
  },
  emptyStateText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#64748b",
  },
  rowSurface: {
    paddingVertical: 8,
  },
  notesText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748b",
  },
});
