import { Button, Column, Host, List, ListItem, Row, Text } from "@expo/ui";
import { DateTime } from "luxon";
import { StyleSheet } from "react-native";

import type { MobileEffectiveScheduleDay, MobileScheduleData, MobileScheduleShift } from "./use-schedule-query";

interface ScheduleScreenProps {
  schedule: MobileScheduleData;
  onRequestAbsence: () => void;
  onViewRequests: () => void;
}

export function ScheduleScreen({ schedule, onRequestAbsence, onViewRequests }: ScheduleScreenProps) {
  const nextShift = schedule.shifts[0] ?? null;

  return (
    <Host style={styles.container}>
      <Column spacing={16}>
        <Column spacing={12} style={styles.headerSurface}>
          <Text textStyle={styles.eyebrowText}>Schedule</Text>
          <Text textStyle={styles.titleText}>
            {nextShift ? `Next shift: ${formatShiftRange(nextShift)}` : "No upcoming shifts"}
          </Text>
          <Text textStyle={styles.descriptionText}>
            Review your published shifts and usual working pattern before requesting time off.
          </Text>
          <Row spacing={8}>
            <Button label="Request Absence" onPress={onRequestAbsence} />
            <Button label="View Requests" onPress={onViewRequests} variant="outlined" />
          </Row>
        </Column>

        <Column spacing={12} style={styles.sectionSurface}>
          <Text textStyle={styles.sectionTitleText}>Upcoming shifts</Text>
          {schedule.shifts.length === 0 ? (
            <Text textStyle={styles.emptyStateText}>No upcoming shifts</Text>
          ) : (
            <List>
              {schedule.shifts.map((shift) => (
                <ShiftRow key={shift.id} shift={shift} />
              ))}
            </List>
          )}
        </Column>

        <Column spacing={12} style={styles.sectionSurface}>
          <Text textStyle={styles.sectionTitleText}>Usual schedule</Text>
          {schedule.effectiveSchedule ? (
            <List>
              <Column spacing={4} style={styles.policySummary}>
                <Text textStyle={styles.rowTitleText}>{schedule.effectiveSchedule.policyName}</Text>
                <Text textStyle={styles.rowMetaText}>{`Assigned via ${schedule.effectiveSchedule.assignedVia}`}</Text>
                {schedule.effectiveSchedule.hoursPerCycle ? (
                  <Text textStyle={styles.rowMetaText}>{`${schedule.effectiveSchedule.hoursPerCycle} hours per cycle`}</Text>
                ) : null}
                <Text textStyle={styles.rowMetaText}>
                  {formatHomeOfficeDays(schedule.effectiveSchedule.homeOfficeDaysPerCycle)}
                </Text>
              </Column>
              {schedule.effectiveSchedule.days.map((day) => (
                <ScheduleDayRow day={day} key={`${day.cycleWeek ?? "week"}-${day.dayOfWeek}`} />
              ))}
            </List>
          ) : (
            <Text textStyle={styles.emptyStateText}>No usual schedule configured</Text>
          )}
        </Column>
      </Column>
    </Host>
  );
}

function ShiftRow({ shift }: { shift: MobileScheduleShift }) {
  return (
    <Column spacing={6} style={styles.rowSurface}>
      <ListItem supportingText={formatTimeRange(shift)} trailing={<Text>{formatStatus(shift.status)}</Text>}>
        {formatDate(shift.date)}
      </ListItem>
      {shift.notes ? <Text textStyle={styles.notesText}>{shift.notes}</Text> : null}
    </Column>
  );
}

function ScheduleDayRow({ day }: { day: MobileEffectiveScheduleDay }) {
  return (
    <ListItem supportingText={day.isWorkDay ? `${day.hoursPerDay} hours` : "Non-work day"}>
      {formatDayName(day.dayOfWeek)}
    </ListItem>
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
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  headerSurface: {
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
  sectionSurface: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  sectionTitleText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  rowSurface: {
    paddingVertical: 8,
  },
  policySummary: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#eff6ff",
  },
  rowTitleText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  rowMetaText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  notesText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748b",
  },
  emptyStateText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#64748b",
  },
});
