import { useState } from "react";
import { DateTime } from "luxon";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileMyRequestsData, MobileRequestItem, MobileRequestSourceType, MobileRequestStatus } from "./use-my-requests-query";

type RequestStatusFilter = "all" | MobileRequestStatus;
type RequestSourceFilter = "all" | MobileRequestSourceType;

interface MyRequestsScreenProps {
  requests: MobileMyRequestsData;
}

interface FilterOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface SummaryTileProps {
  label: string;
  value: number;
}

interface FilterChipProps<TValue extends string> {
  option: FilterOption<TValue>;
  isActive: boolean;
  onSelect: (value: TValue) => void;
}

interface RequestSectionProps {
  title: string;
  requests: MobileRequestItem[];
  emptyLabel: string;
}

const STATUS_FILTER_OPTIONS: Array<FilterOption<RequestStatusFilter>> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const SOURCE_FILTER_OPTIONS: Array<FilterOption<RequestSourceFilter>> = [
  { value: "all", label: "All Sources" },
  { value: "absence", label: "Absence" },
  { value: "time_correction", label: "Time Correction" },
  { value: "travel_expense", label: "Travel Expense" },
];

export function MyRequestsScreen({ requests }: MyRequestsScreenProps) {
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<RequestSourceFilter>("all");
  const filteredRequests = filterRequests(requests.items, statusFilter, sourceFilter);
  const hasLoadedItems = requests.items.length > 0;
  const needsAttentionRequests = filteredRequests.filter((request) => request.status === "rejected");
  const inReviewRequests = filteredRequests.filter((request) => request.status === "pending");
  const recentlyDecidedRequests = filteredRequests.filter(isRecentlyDecided);

  return (
    <View style={styles.container}>
      <View style={styles.headerSurface}>
        <Text style={styles.eyebrow}>Requests</Text>
        <Text style={styles.title}>My Requests</Text>
        <Text style={styles.description}>
          Track absences, time corrections, and travel expenses from one mobile view.
        </Text>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryTile label="Pending" value={requests.counts.pending} />
        <SummaryTile label="Required Fixes" value={requests.counts.requiredFixes} />
        <SummaryTile label="Recent Decisions" value={requests.counts.recentDecisions} />
        <SummaryTile label="Total" value={requests.counts.total} />
      </View>

      {requests.sourceErrors.length > 0 ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.warningMessage}>
          Some requests could not be loaded
        </Text>
      ) : null}

      <View style={styles.filterSurface}>
        <Text style={styles.filterLabel}>Status</Text>
        <View style={styles.filterRow}>
          {STATUS_FILTER_OPTIONS.map((option) => (
            <FilterChip
              isActive={option.value === statusFilter}
              key={option.value}
              onSelect={setStatusFilter}
              option={option}
            />
          ))}
        </View>
        <Text style={styles.filterLabel}>Source</Text>
        <View style={styles.filterRow}>
          {SOURCE_FILTER_OPTIONS.map((option) => (
            <FilterChip
              isActive={option.value === sourceFilter}
              key={option.value}
              onSelect={setSourceFilter}
              option={option}
            />
          ))}
        </View>
      </View>

      {!hasLoadedItems ? (
        <Text style={styles.emptyState}>No requests yet</Text>
      ) : filteredRequests.length === 0 ? (
        <Text style={styles.emptyState}>No requests match these filters</Text>
      ) : (
        <View style={styles.list}>
          <RequestSection
            emptyLabel="No rejected requests need attention"
            requests={needsAttentionRequests}
            title="Needs attention"
          />
          <RequestSection emptyLabel="No pending requests" requests={inReviewRequests} title="In review" />
          <RequestSection
            emptyLabel="No recent decisions"
            requests={recentlyDecidedRequests}
            title="Recently decided"
          />
          <RequestSection emptyLabel="No requests match these filters" requests={filteredRequests} title="All requests" />
        </View>
      )}
    </View>
  );
}

function SummaryTile({ label, value }: SummaryTileProps) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function FilterChip<TValue extends string>({ option, isActive, onSelect }: FilterChipProps<TValue>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={() => onSelect(option.value)}
      style={[styles.filterChip, isActive && styles.filterChipActive]}
    >
      <Text style={[styles.filterChipLabel, isActive && styles.filterChipLabelActive]}>{option.label}</Text>
    </Pressable>
  );
}

function RequestSection({ title, requests, emptyLabel }: RequestSectionProps) {
  return (
    <View style={styles.sectionSurface}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {requests.length === 0 ? (
        <Text style={styles.sectionEmptyState}>{emptyLabel}</Text>
      ) : (
        <View style={styles.sectionList}>
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </View>
      )}
    </View>
  );
}

function RequestCard({ request }: { request: MobileRequestItem }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.sourceLabel}>{formatSourceType(request.sourceType)}</Text>
        <View style={[styles.statusBadge, getStatusBadgeStyle(request.status)]}>
          <Text style={styles.statusLabel}>{formatStatus(request.status)}</Text>
        </View>
      </View>
      <Text style={styles.cardTitle}>{request.title}</Text>
      {request.subtitle ? <Text style={styles.cardMeta}>{request.subtitle}</Text> : null}
      <Text style={styles.cardMeta}>Submitted {formatDate(request.submittedAt)}</Text>
      {request.resolvedAt ? <Text style={styles.cardMeta}>Resolved {formatDate(request.resolvedAt)}</Text> : null}
      {request.decisionReason ? (
        <Text style={styles.decisionReason}>Decision reason: {request.decisionReason}</Text>
      ) : null}
    </View>
  );
}

function filterRequests(
  requests: MobileRequestItem[],
  statusFilter: RequestStatusFilter,
  sourceFilter: RequestSourceFilter,
) {
  return requests.filter((request) => {
    const matchesStatus = statusFilter === "all" || request.status === statusFilter;
    const matchesSource = sourceFilter === "all" || request.sourceType === sourceFilter;

    return matchesStatus && matchesSource;
  });
}

function isRecentlyDecided(request: MobileRequestItem) {
  if (!request.resolvedAt || (request.status !== "approved" && request.status !== "rejected")) {
    return false;
  }

  const resolvedAt = DateTime.fromISO(request.resolvedAt);
  const recentThreshold = DateTime.now().minus({ days: 30 });

  return resolvedAt >= recentThreshold;
}

function formatDate(value: string) {
  return DateTime.fromISO(value).toLocaleString(DateTime.DATE_MED);
}

function formatStatus(status: MobileRequestStatus) {
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

function formatSourceType(sourceType: MobileRequestSourceType) {
  if (sourceType === "absence") {
    return "Absence";
  }

  if (sourceType === "time_correction") {
    return "Time Correction";
  }

  return "Travel Expense";
}

function getStatusBadgeStyle(status: MobileRequestStatus) {
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
    fontSize: 14,
    lineHeight: 21,
    color: "#475569",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryTile: {
    minWidth: 132,
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  summaryValue: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "700",
    color: "#0f172a",
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  warningMessage: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fed7aa",
    padding: 12,
    fontSize: 13,
    lineHeight: 18,
    color: "#9a3412",
    backgroundColor: "#fff7ed",
  },
  filterSurface: {
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbeafe",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dbe2f0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f8fafc",
  },
  filterChipActive: {
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  filterChipLabelActive: {
    color: "#1d4ed8",
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 18,
    fontSize: 14,
    lineHeight: 20,
    color: "#64748b",
    backgroundColor: "#ffffff",
  },
  list: {
    gap: 14,
  },
  sectionSurface: {
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 18,
    backgroundColor: "#ffffff",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  sectionEmptyState: {
    fontSize: 14,
    lineHeight: 20,
    color: "#64748b",
  },
  sectionList: {
    gap: 12,
  },
  card: {
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    backgroundColor: "#f8fafc",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sourceLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#2563eb",
  },
  statusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
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
  cardTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
    color: "#0f172a",
  },
  cardMeta: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  decisionReason: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
    padding: 10,
    fontSize: 13,
    lineHeight: 18,
    color: "#991b1b",
    backgroundColor: "#fef2f2",
  },
});
