import React from "react";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";

import { AbsencesScreen } from "./absences-screen";
import type { MobileAbsenceRecord } from "./use-absences-query";

vi.mock("react-native", () => ({
  Pressable: ({ accessibilityLabel, accessibilityState, children, ...props }: any) =>
    React.createElement(
      "button",
      {
        ...props,
        ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
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

function createAbsence(overrides: Partial<MobileAbsenceRecord>): MobileAbsenceRecord {
  return {
    id: "absence-1",
    employeeId: "employee-1",
    startDate: "2026-04-12",
    endDate: "2026-04-12",
    startPeriod: "full_day",
    endPeriod: "full_day",
    status: "pending",
    notes: null,
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    createdAt: "2026-04-01T08:00:00.000Z",
    category: {
      id: "category-1",
      name: "Vacation",
      type: "vacation",
      color: "#2563eb",
      countsAgainstVacation: true,
    },
    ...overrides,
  };
}

describe("AbsencesScreen", () => {
  it("shows cancel only for pending absences", () => {
    const html = renderToStaticMarkup(
      React.createElement(AbsencesScreen, {
        absences: [
          createAbsence({ id: "pending-1", status: "pending" }),
          createAbsence({ id: "approved-1", status: "approved" }),
          createAbsence({ id: "rejected-1", status: "rejected" }),
        ],
        isLoading: false,
        onCancelAbsence: vi.fn(),
        onRequestAbsence: vi.fn(),
        isCancellingAbsence: false,
      }),
    );

    expect(html.match(/Cancel Request/g)).toHaveLength(1);
  });
});
