import React from "react";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";

import { MyRequestsScreen } from "./my-requests-screen";
import type { MobileMyRequestsData, MobileRequestItem } from "./use-my-requests-query";

vi.mock("react-native", () => ({
  Pressable: ({ accessibilityState, children, ...props }: any) =>
    React.createElement(
      "button",
      {
        ...props,
        ...(accessibilityState?.selected !== undefined
          ? { "data-selected": accessibilityState.selected }
          : {}),
      },
      children,
    ),
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  Text: ({ children, ...props }: any) => React.createElement("span", props, children),
  View: ({ children, ...props }: any) => React.createElement("div", props, children),
}));

function createRequest(overrides: Partial<MobileRequestItem>): MobileRequestItem {
  return {
    id: "absence:request-1",
    sourceType: "absence",
    sourceId: "request-1",
    organizationId: "org-1",
    employeeId: "employee-1",
    status: "pending",
    submittedAt: "2026-04-10T08:30:00.000Z",
    resolvedAt: null,
    title: "Vacation",
    subtitle: "May 1, 2026 to May 2, 2026",
    decisionReason: null,
    availableActions: ["view"],
    sourceHref: "/absences",
    ...overrides,
  };
}

const requestsData: MobileMyRequestsData = {
  items: [
    createRequest({ id: "absence:pending-1", title: "Vacation", status: "pending" }),
    createRequest({
      id: "time_correction:rejected-1",
      sourceType: "time_correction",
      sourceId: "correction-1",
      status: "rejected",
      title: "Time correction",
      subtitle: "Apr 9, 2026",
      resolvedAt: "2026-04-12T10:15:00.000Z",
      decisionReason: "Add a note explaining the missed punch.",
      availableActions: ["view", "fix"],
      sourceHref: "/my-requests",
    }),
    createRequest({
      id: "travel_expense:approved-1",
      sourceType: "travel_expense",
      sourceId: "expense-1",
      status: "approved",
      title: "Client visit mileage",
      subtitle: "EUR 42.00",
      resolvedAt: "2026-04-13T09:00:00.000Z",
      availableActions: ["view"],
      sourceHref: "/travel-expenses",
    }),
  ],
  counts: {
    pending: 1,
    requiredFixes: 1,
    recentDecisions: 2,
    total: 3,
  },
  sourceErrors: [{ sourceType: "travel_expense", message: "Travel expense requests could not be loaded." }],
};

describe("MyRequestsScreen", () => {
  it("renders summary counts, source warning, grouped sections, and decision reason", () => {
    const html = renderToStaticMarkup(React.createElement(MyRequestsScreen, { requests: requestsData }));

    expect(html).toContain("My Requests");
    expect(html).toContain("Pending");
    expect(html).toContain("Required Fixes");
    expect(html).toContain("Recent Decisions");
    expect(html).toContain("Total");
    expect(html).toMatch(/<span[^>]*>1<\/span><span[^>]*>Pending<\/span>/);
    expect(html).toMatch(/<span[^>]*>1<\/span><span[^>]*>Required Fixes<\/span>/);
    expect(html).toMatch(/<span[^>]*>2<\/span><span[^>]*>Recent Decisions<\/span>/);
    expect(html).toMatch(/<span[^>]*>3<\/span><span[^>]*>Total<\/span>/);
    expect(html).toContain("Some requests could not be loaded");
    expect(html).toContain("Needs attention");
    expect(html).toContain("In review");
    expect(html).toContain("Recently decided");
    expect(html).toContain("All requests");
    expect(html).toContain("Absence");
    expect(html).toContain("Time Correction");
    expect(html).toContain("Travel Expense");
    expect(html).toContain("Add a note explaining the missed punch.");
    expect(html).toContain("Submitted Apr 10, 2026");
    expect(html).toContain("Resolved Apr 12, 2026");
    expect(html).toContain("data-selected=\"true\"");
  });

  it("renders no requests empty state when there are no loaded items", () => {
    const html = renderToStaticMarkup(
      React.createElement(MyRequestsScreen, {
        requests: {
          items: [],
          counts: {
            pending: 0,
            requiredFixes: 0,
            recentDecisions: 0,
            total: 0,
          },
          sourceErrors: [],
        },
      }),
    );

    expect(html).toContain("No requests yet");
  });
});
