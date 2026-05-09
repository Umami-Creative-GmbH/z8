import { DateTime } from "luxon";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { MobileEffectiveScheduleDay, MobileScheduleData, MobileScheduleShift } from "./use-schedule-query";

interface ScheduleScreenProps {
  schedule: MobileScheduleData;
  onRequestAbsence: () => void;
  onViewRequests: () => void;
}

interface ActionButtonProps {
  label: string;
  accessibilityLabel: string;
  variant: "primary" | "secondary";
  onPress: () => void;
}

export function ScheduleScreen({ schedule, onRequestAbsence, onViewRequests }: ScheduleScreenProps) {
  const nextShift = schedule.shifts[0] ?? null;

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.container}>
      <View style={styles.headerSurface}>
        <Text style={styles.eyebrow}>Schedule</Text>
        <Text style={styles.title}>{nextShift ? `Next shift: ${formatShiftRange(nextShift)}` : "No upcoming shifts"}</Text>
        <Text style={styles.description}>
          Review your published shifts and usual working pattern before requesting time off.
        </Text>
        <View style={styles.actionRow}>
          <ActionButton
            accessibilityLabel="Request Absence"
            label="Request Absence"
            onPress={onRequestAbsence}
            variant="primary"
          />
          <ActionButton
            accessibilityLabel="View Requests"
            label="View Requests"
            onPress={onViewRequests}
            variant="secondary"
          />
        </View>
      </View>

      <View style={styles.sectionSurface}>
        <Text style={styles.sectionTitle}>Upcoming shifts</Text>
        {schedule.shifts.length === 0 ? (
          <Text style={styles.emptyState}>No upcoming shifts</Text>
        ) : (
          <View style={styles.list}>
            {schedule.shifts.map((shift) => (
              <ShiftRow key={shift.id} shift={shift} />
            ))}
          </View>
        )}
      </View>

      <View style={styles.sectionSurface}>
        <Text style={styles.sectionTitle}>Usual schedule</Text>
        {schedule.effectiveSchedule ? (
          <View style={styles.list}>
            <View style={styles.policySummary}>
              <Text style={styles.rowTitle}>{schedule.effectiveSchedule.policyName}</Text>
              <Text style={styles.rowMeta}>Assigned via {schedule.effectiveSchedule.assignedVia}</Text>
              {schedule.effectiveSchedule.hoursPerCycle ? (
                <Text style={styles.rowMeta}>{schedule.effectiveSchedule.hoursPerCycle} hours per cycle</Text>
              ) : null}
              <Text style={styles.rowMeta}>
                {formatHomeOfficeDays(schedule.effectiveSchedule.homeOfficeDaysPerCycle)}
              </Text>
            </View>
            {schedule.effectiveSchedule.days.map((day) => (
              <ScheduleDayRow day={day} key={`${day.cycleWeek ?? "week"}-${day.dayOfWeek}`} />
            ))}
          </View>
        ) : (
          <Text style={styles.emptyState}>No usual schedule configured</Text>
        )}
      </View>
    </ScrollView>
  );
}

function ActionButton({ label, accessibilityLabel, variant, onPress }: ActionButtonProps) {
  const isPrimary = variant === "primary";

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.actionButton, isPrimary ? styles.primaryAction : styles.secondaryAction]}
    >
      <Text style={isPrimary ? styles.primaryActionLabel : styles.secondaryActionLabel}>{label}</Text>
    </Pressable>
  );
}

function ShiftRow({ shift }: { shift: MobileScheduleShift }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{formatDate(shift.date)}</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusLabel}>{formatStatus(shift.status)}</Text>
        </View>
      </View>
      <Text style={styles.rowMeta}>{formatTimeRange(shift)}</Text>
      {shift.notes ? <Text style={styles.notes}>{shift.notes}</Text> : null}
    </View>
  );
}

function ScheduleDayRow({ day }: { day: MobileEffectiveScheduleDay }) {
  return (
    <View style={styles.dayRow}>
      <Text style={styles.dayName}>{formatDayName(day.dayOfWeek)}</Text>
      <Text style={styles.dayMeta}>{day.isWorkDay ? `${day.hoursPerDay} hours` : "Non-work day"}</Text>
    </View>
  );
}

function formatDate(date: string) {
  return DateTime.fromISO(date).toLocaleString(DateTime.DATE_MED);
}

function formatShiftRange(shift: MobileScheduleShift) {
  return `${formatDate(shift.date)}, ${formatTimeRange(shift)}`;
}

function formatTimeRange(shift: MobileScheduleShift) {
  return `${formatTime(shift.date, shift.startTime)} to ${formatTime(shift.date, shift.endTime)}`;
}

function formatTime(date: string, time: string) {
  return DateTime.fromISO(`${date}T${time}`).toLocaleString(DateTime.TIME_SIMPLE);
}

function formatStatus(status: MobileScheduleShift["status"]) {
  if (status === "published") {
    return "Published";
  }

  return status;
}

function formatDayName(dayOfWeek: string) {
  return dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);
}

function formatHomeOfficeDays(days: number | null) {
  const count = days ?? 0;
  const label = count === 1 ? "day" : "days";

  return `${count} home office ${label} per cycle`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  content: {
    padding: 20,
    gap: 16,
  },
  headerSurface: {
    padding: 18,
    gap: 12,
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
  actionRow: {
    gap: 10,
  },
  actionButton: {
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryAction: {
    backgroundColor: "#2563eb",
  },
  primaryActionLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
  },
  secondaryActionLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  sectionSurface: {
    padding: 18,
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
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
    borderWidth: 1,
    borderColor: "#99f6e4",
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#f0fdfa",
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0f172a",
  },
  policySummary: {
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dbeafe",
    padding: 14,
    backgroundColor: "#eff6ff",
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    backgroundColor: "#ffffff",
  },
  dayName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  dayMeta: {
    fontSize: 14,
    color: "#475569",
  },
});
