import { Button, Column, Host, List, ListItem, Row, ScrollView, Text } from "@expo/ui";
import { useState } from "react";
import { DateTime } from "luxon";
import { StyleSheet, Text as NativeText } from "react-native";

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
    <Host style={styles.container}>
      <ScrollView>
        <Column spacing={16} style={styles.content}>
          <Column spacing={12} style={styles.headerSurface}>
            <Text textStyle={styles.eyebrowText}>Requests</Text>
            <Text textStyle={styles.titleText}>My Requests</Text>
            <Text textStyle={styles.descriptionText}>
              Track absences, time corrections, and travel expenses from one mobile view.
            </Text>
          </Column>

          <Column spacing={10}>
            <Row spacing={10}>
              <SummaryTile label="Pending" value={requests.counts.pending} />
              <SummaryTile label="Required Fixes" value={requests.counts.requiredFixes} />
            </Row>
            <Row spacing={10}>
              <SummaryTile label="Recent Decisions" value={requests.counts.recentDecisions} />
              <SummaryTile label="Total" value={requests.counts.total} />
            </Row>
          </Column>

          {requests.sourceErrors.length > 0 ? (
            <NativeText accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.warningMessageText}>
              Some requests could not be loaded
            </NativeText>
          ) : null}

          <Column spacing={10} style={styles.filterSurface}>
            <Text textStyle={styles.filterLabelText}>Status</Text>
            <Row spacing={8}>
              {STATUS_FILTER_OPTIONS.slice(0, 3).map((option) => (
                <FilterChip
                  isActive={option.value === statusFilter}
                  key={option.value}
                  onSelect={setStatusFilter}
                  option={option}
                />
              ))}
            </Row>
            <Row spacing={8}>
              {STATUS_FILTER_OPTIONS.slice(3).map((option) => (
                <FilterChip
                  isActive={option.value === statusFilter}
                  key={option.value}
                  onSelect={setStatusFilter}
                  option={option}
                />
              ))}
            </Row>
            <Text textStyle={styles.filterLabelText}>Source</Text>
            <Row spacing={8}>
              {SOURCE_FILTER_OPTIONS.slice(0, 2).map((option) => (
                <FilterChip
                  isActive={option.value === sourceFilter}
                  key={option.value}
                  onSelect={setSourceFilter}
                  option={option}
                />
              ))}
            </Row>
            <Row spacing={8}>
              {SOURCE_FILTER_OPTIONS.slice(2).map((option) => (
                <FilterChip
                  isActive={option.value === sourceFilter}
                  key={option.value}
                  onSelect={setSourceFilter}
                  option={option}
                />
              ))}
            </Row>
          </Column>

          {!hasLoadedItems ? (
            <Text textStyle={styles.emptyStateText}>No requests yet</Text>
          ) : filteredRequests.length === 0 ? (
            <Text textStyle={styles.emptyStateText}>No requests match these filters</Text>
          ) : (
            <Column spacing={14}>
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
            </Column>
          )}
        </Column>
      </ScrollView>
    </Host>
  );
}

function SummaryTile({ label, value }: SummaryTileProps) {
  return (
    <Column spacing={2} style={styles.summaryTile}>
      <Text textStyle={styles.summaryValueText}>{String(value)}</Text>
      <Text textStyle={styles.summaryLabelText}>{label}</Text>
    </Column>
  );
}

function FilterChip<TValue extends string>({ option, isActive, onSelect }: FilterChipProps<TValue>) {
  return (
    <Button
      label={isActive ? `${option.label} selected` : option.label}
      onPress={() => onSelect(option.value)}
      variant={isActive ? "filled" : "outlined"}
    />
  );
}

function RequestSection({ title, requests, emptyLabel }: RequestSectionProps) {
  return (
    <Column spacing={12} style={styles.sectionSurface}>
      <Text textStyle={styles.sectionTitleText}>{title}</Text>
      {requests.length === 0 ? (
        <Text textStyle={styles.sectionEmptyStateText}>{emptyLabel}</Text>
      ) : (
        <List>
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </List>
      )}
    </Column>
  );
}

function RequestCard({ request }: { request: MobileRequestItem }) {
  return (
    <Column spacing={6} style={styles.cardSurface}>
      <ListItem
        supportingText={`${formatSourceType(request.sourceType)} · Submitted ${formatDate(request.submittedAt)}`}
        trailing={<Text>{formatStatus(request.status)}</Text>}
      >
        {request.title}
      </ListItem>
      {request.subtitle ? <Text textStyle={styles.cardMetaText}>{request.subtitle}</Text> : null}
      {request.resolvedAt ? <Text textStyle={styles.cardMetaText}>{`Resolved ${formatDate(request.resolvedAt)}`}</Text> : null}
      {request.decisionReason ? (
        <Text textStyle={styles.decisionReasonText}>{`Decision reason: ${request.decisionReason}`}</Text>
      ) : null}
    </Column>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  content: {
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
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "700",
    color: "#0f172a",
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 21,
    color: "#475569",
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
  summaryValueText: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "700",
    color: "#0f172a",
  },
  summaryLabelText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  warningMessageText: {
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
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#ffffff",
  },
  filterLabelText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
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
  sectionEmptyStateText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#64748b",
  },
  cardSurface: {
    paddingVertical: 8,
  },
  cardMetaText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  decisionReasonText: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
    padding: 10,
    fontSize: 13,
    lineHeight: 18,
    color: "#991b1b",
    backgroundColor: "#fef2f2",
  },
  emptyStateText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#64748b",
  },
});
