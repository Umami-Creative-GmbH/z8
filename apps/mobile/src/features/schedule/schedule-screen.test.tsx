import React from "react";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";

import { ScheduleScreen } from "./schedule-screen";
import type { MobileScheduleData } from "./use-schedule-query";

vi.mock("react-native", () => ({
  Pressable: ({ accessibilityLabel, children, ...props }: any) =>
    React.createElement(
      "button",
      {
        ...props,
        ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
      },
      children,
    ),
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  Text: ({ children, ...props }: any) => React.createElement("span", props, children),
  View: ({ children, ...props }: any) => React.createElement("div", props, children),
}));

const scheduleData: MobileScheduleData = {
  activeOrganizationId: "org-1",
  shifts: [
    {
      id: "shift-1",
      date: "2026-04-12",
      startTime: "09:00",
      endTime: "17:00",
      status: "published",
      notes: "Front desk",
      color: "#2563eb",
    },
  ],
  effectiveSchedule: {
    policyName: "Standard",
    assignedVia: "Organization Default",
    scheduleCycle: "weekly",
    scheduleType: "fixed",
    hoursPerCycle: "40.00",
    homeOfficeDaysPerCycle: 1,
    days: [
      {
        dayOfWeek: "monday",
        hoursPerDay: "8.00",
        isWorkDay: true,
        cycleWeek: null,
      },
      {
        dayOfWeek: "saturday",
        hoursPerDay: "0.00",
        isWorkDay: false,
        cycleWeek: null,
      },
    ],
  },
};

describe("ScheduleScreen", () => {
  it("renders upcoming shifts and the usual schedule", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScheduleScreen, {
        schedule: scheduleData,
        onRequestAbsence: vi.fn(),
        onViewRequests: vi.fn(),
      }),
    );

    expect(html).toContain("Schedule");
    expect(html).toContain("Next shift: Apr 12, 2026, 9:00 AM to 5:00 PM");
    expect(html).toContain("Published");
    expect(html).toContain("Front desk");
    expect(html).toContain("Standard");
    expect(html).toContain("Organization Default");
    expect(html).toContain("40.00 hours per cycle");
    expect(html).toContain("1 home office day per cycle");
    expect(html).toContain("Monday");
    expect(html).toContain("8.00 hours");
    expect(html).toContain("Saturday");
    expect(html).toContain("Non-work day");
    expect(html).toContain("aria-label=\"Request Absence\"");
    expect(html).toContain("aria-label=\"View Requests\"");
  });

  it("renders distinct empty states for shifts and usual schedule", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScheduleScreen, {
        schedule: {
          activeOrganizationId: "org-1",
          shifts: [],
          effectiveSchedule: null,
        },
        onRequestAbsence: vi.fn(),
        onViewRequests: vi.fn(),
      }),
    );

    expect(html).toContain("No upcoming shifts");
    expect(html).toContain("No usual schedule configured");
  });
});
