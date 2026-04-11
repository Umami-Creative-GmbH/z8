import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

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
    <View style={styles.container}>
      <View style={styles.headerSurface}>
        <Text style={styles.eyebrow}>Absences</Text>
        <Text style={styles.title}>Track your requests and upcoming time off</Text>
        <Text style={styles.description}>
          Keep upcoming absences visible and cancel pending requests when plans change.
        </Text>

        <Pressable
          accessibilityLabel="Request Absence"
          accessibilityRole="button"
          onPress={onRequestAbsence}
          style={styles.primaryAction}
        >
          <Text style={styles.primaryActionLabel}>Request Absence</Text>
        </Pressable>
      </View>

      <View style={styles.listSurface}>
        <View style={styles.filterRow}>
          {FILTER_OPTIONS.map((option) => {
            const isActive = option.value === activeFilter;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                key={option.value}
                onPress={() => setActiveFilter(option.value)}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipLabel, isActive && styles.filterChipLabelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {errorMessage ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorMessage}>
            {errorMessage}
          </Text>
        ) : null}

        {isLoading ? (
          <Text style={styles.emptyState}>Loading absences…</Text>
        ) : filteredAbsences.length === 0 ? (
          <Text style={styles.emptyState}>{getEmptyStateLabel(activeFilter)}</Text>
        ) : (
          <View style={styles.list}>
            {filteredAbsences.map((absence) => {
              const isPending = absence.status === "pending";
              const isCancellingCurrent = cancellingAbsenceId === absence.id && isCancellingAbsence;

              return (
                <View key={absence.id} style={styles.row}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.rowTitle}>{absence.category.name}</Text>
                    <View style={[styles.statusBadge, getStatusBadgeStyle(absence.status)]}>
                      <Text style={styles.statusLabel}>{formatStatus(absence.status)}</Text>
                    </View>
                  </View>
                  <Text style={styles.rowMeta}>{formatDateRange(absence)}</Text>
                  {absence.notes ? <Text style={styles.notes}>{absence.notes}</Text> : null}
                  {isPending ? (
                    <Pressable
                      accessibilityLabel={`Cancel ${absence.category.name} request`}
                      accessibilityRole="button"
                      disabled={isCancellingAbsence}
                      onPress={
                        isCancellingAbsence
                          ? undefined
                          : () => handleCancelAbsence(absence.id, absence.category.name)
                      }
                      style={[styles.secondaryAction, isCancellingAbsence && styles.actionDisabled]}
                    >
                      <Text style={styles.secondaryActionLabel}>
                        {isCancellingCurrent ? "Cancelling…" : "Cancel Request"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
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

function getStatusBadgeStyle(status: MobileAbsenceRecord["status"]) {
  if (status === "approved") {
    return styles.statusApproved;
  }

  if (status === "pending") {
    return styles.statusPending;
  }

  if (status === "rejected") {
    return styles.statusRejected;
  }

  return styles.statusCancelled;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 16,
    backgroundColor: "#f8fafc",
  },
  headerSurface: {
    padding: 18,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbe2f0",
    backgroundColor: "#ffffff",
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
    color: "#3730a3",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "700",
    color: "#0f172a",
  },
  description: {
    fontSize: 14,
    lineHeight: 21,
    color: "#475569",
  },
  primaryAction: {
    marginTop: 4,
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: "#3730a3",
  },
  primaryActionLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  listSurface: {
    flex: 1,
    padding: 18,
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbe2f0",
    backgroundColor: "#ffffff",
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
  },
  filterChip: {
    flex: 1,
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dbe2f0",
    paddingVertical: 10,
    backgroundColor: "#f8fafc",
  },
  filterChipActive: {
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff",
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  filterChipLabelActive: {
    color: "#3730a3",
  },
  errorMessage: {
    fontSize: 13,
    lineHeight: 18,
    color: "#b91c1c",
  },
  emptyState: {
    fontSize: 14,
    lineHeight: 20,
    color: "#64748b",
  },
  list: {
    gap: 12,
  },
  row: {
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    backgroundColor: "#f8fafc",
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  rowMeta: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  notes: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748b",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0f172a",
  },
  statusApproved: {
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa",
  },
  statusPending: {
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
  },
  statusRejected: {
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  statusCancelled: {
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
  },
  secondaryAction: {
    alignSelf: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#fff1f2",
  },
  secondaryActionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#be123c",
  },
  actionDisabled: {
    opacity: 0.55,
  },
});
