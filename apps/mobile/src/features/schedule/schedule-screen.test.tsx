import React from "react";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";

import { ScheduleScreen } from "./schedule-screen";
import type { MobileScheduleData } from "./use-schedule-query";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  Text: "Text",
  View: "View",
}));

const KNOWN_MOCK_COMPONENT_NAMES = new Set(["Button", "List", "ListItem", "Primitive"]);

function shouldRenderKnownMockComponent(element: React.ReactElement<any>) {
  return typeof element.type === "function" && KNOWN_MOCK_COMPONENT_NAMES.has(element.type.name);
}

function findNode(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any>) => boolean,
): React.ReactElement<any> | null {
  if (!React.isValidElement(node)) {
    return null;
  }

  const element = node as React.ReactElement<any>;

  if (shouldRenderKnownMockComponent(element)) {
    const Component = element.type as (props: any) => React.ReactNode;

    return findNode(Component(element.props), predicate);
  }

  if (predicate(element)) {
    return element;
  }

  const children = React.Children.toArray(element.props.children);

  for (const child of children) {
    const match = findNode(child, predicate);
    if (match) {
      return match;
    }
  }

  return null;
}

function getTextContent(node: React.ReactNode): string {
  if (typeof node === "string") {
    return node;
  }

  if (!React.isValidElement(node)) {
    return "";
  }

  const element = node as React.ReactElement<any>;

  if (shouldRenderKnownMockComponent(element)) {
    const Component = element.type as (props: any) => React.ReactNode;

    return getTextContent(Component(element.props));
  }

  return React.Children.toArray(element.props.children).map(getTextContent).join("");
}

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
  it("renders upcoming shifts and the usual schedule with Expo UI content", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScheduleScreen, {
        schedule: scheduleData,
        onRequestAbsence: vi.fn(),
        onViewRequests: vi.fn(),
      }),
    );

    expect(html).toContain("<ScrollView");
    expect(html).toContain("Schedule");
    expect(html).toContain("Next shift: Apr 12, 2026, 9:00 AM to 5:00 PM");
    expect(html).toContain("Front desk");
    expect(html).toContain("Standard");
    expect(html).toContain("Assigned via Organization Default");
    expect(html).toContain("40.00 hours per cycle");
    expect(html).toContain("1 home office day per cycle");
    expect(html).toContain("Monday");
    expect(html).toContain("8.00 hours");
    expect(html).toContain("Saturday");
    expect(html).toContain("Non-work day");
  });

  it("calls schedule actions from Expo UI buttons", () => {
    const onRequestAbsence = vi.fn();
    const onViewRequests = vi.fn();
    const tree = ScheduleScreen({ schedule: scheduleData, onRequestAbsence, onViewRequests });

    const requestButton = findNode(
      tree,
      (node) => node.type === "Button" && getTextContent(node) === "Request Absence",
    );
    const viewButton = findNode(
      tree,
      (node) => node.type === "Button" && getTextContent(node) === "View Requests",
    );

    requestButton?.props.onPress?.();
    viewButton?.props.onPress?.();

    expect(onRequestAbsence).toHaveBeenCalledOnce();
    expect(onViewRequests).toHaveBeenCalledOnce();
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
