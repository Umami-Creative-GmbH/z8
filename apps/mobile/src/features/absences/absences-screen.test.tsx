import React from "react";
import { DateTime } from "luxon";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";
import { Alert } from "react-native";

import { AbsencesScreen } from "./absences-screen";
import type { MobileAbsenceRecord } from "./use-absences-query";

const expoUiButtons = vi.hoisted(() => [] as Array<{ label?: string; onPress?: () => void }>);

vi.mock("@expo/ui", async () => {
  const expoUiMock = await vi.importActual<typeof import("../../../test/expo-ui-mock")>("../../../test/expo-ui-mock");

  return {
    ...expoUiMock,
    Button(props: { label?: string; onPress?: () => void; disabled?: boolean; children?: React.ReactNode }) {
      expoUiButtons.push(props);

      return expoUiMock.Button(props);
    },
  };
});

vi.mock("react-native", () => ({
  Alert: {
    alert: vi.fn(),
  },
  Pressable: "Pressable",
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  Text: "Text",
  View: "View",
}));

function createAbsence(overrides: Partial<MobileAbsenceRecord>): MobileAbsenceRecord {
  const futureDate = DateTime.now().plus({ days: 7 }).toISODate();

  return {
    id: "absence-1",
    employeeId: "employee-1",
    startDate: futureDate,
    endDate: futureDate,
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00.000Z"));
    expoUiButtons.length = 0;
    vi.mocked(Alert.alert).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves loading, error, empty, and request action content", () => {
    const html = renderToStaticMarkup(
      React.createElement(AbsencesScreen, {
        absences: [],
        errorMessage: "Could not load absences",
        isCancellingAbsence: false,
        isLoading: true,
        onCancelAbsence: vi.fn(),
        onRequestAbsence: vi.fn(),
      }),
    );

    expect(html).toContain("<Host");
    expect(html).toContain("Could not load absences");
    expect(html).toContain("Loading absences…");
    expect(html).toContain("Request Absence");
  });

  it("renders absence filters, rows, notes, and pending cancellation state", () => {
    const html = renderToStaticMarkup(
      React.createElement(AbsencesScreen, {
        absences: [createAbsence({ id: "pending-1", notes: "Family trip", status: "pending" })],
        cancellingAbsenceId: "pending-1",
        isCancellingAbsence: true,
        isLoading: false,
        onCancelAbsence: vi.fn(),
        onRequestAbsence: vi.fn(),
      }),
    );

    expect(html).toContain("Upcoming");
    expect(html).toContain("Pending");
    expect(html).toContain("Past");
    expect(html).toContain("Vacation");
    expect(html).toContain("Pending");
    expect(html).toContain("Family trip");
    expect(html).toContain("Cancelling…");
    expect(html).toContain("variant=\"filled\"");
    expect(html).toContain("variant=\"outlined\"");
  });

  it("renders upcoming empty state", () => {
    const html = renderToStaticMarkup(
      React.createElement(AbsencesScreen, {
        absences: [],
        isCancellingAbsence: false,
        isLoading: false,
        onCancelAbsence: vi.fn(),
        onRequestAbsence: vi.fn(),
      }),
    );

    expect(html).toContain("No upcoming absences");
  });

  it("calls the request absence action from the Expo UI button", () => {
    const onRequestAbsence = vi.fn();
    renderToStaticMarkup(
      React.createElement(AbsencesScreen, {
        absences: [],
        isCancellingAbsence: false,
        isLoading: false,
        onCancelAbsence: vi.fn(),
        onRequestAbsence,
      }),
    );
    const requestButton = expoUiButtons.find((button) => button.label === "Request Absence");

    requestButton?.onPress?.();

    expect(onRequestAbsence).toHaveBeenCalledOnce();
  });

  it("confirms and calls the cancel absence action for pending rows", () => {
    const onCancelAbsence = vi.fn();
    renderToStaticMarkup(
      React.createElement(AbsencesScreen, {
        absences: [createAbsence({ id: "pending-1", status: "pending" })],
        isCancellingAbsence: false,
        isLoading: false,
        onCancelAbsence,
        onRequestAbsence: vi.fn(),
      }),
    );
    const cancelButton = expoUiButtons.find((button) => button.label === "Cancel Request");

    cancelButton?.onPress?.();

    expect(Alert.alert).toHaveBeenCalledWith(
      "Cancel request?",
      "Cancel your Vacation absence request?",
      expect.arrayContaining([
        expect.objectContaining({ text: "Keep request", style: "cancel" }),
        expect.objectContaining({ text: "Cancel request", style: "destructive" }),
      ]),
    );

    const destructiveAction = vi.mocked(Alert.alert).mock.calls[0]?.[2]?.[1];
    destructiveAction?.onPress?.();

    expect(onCancelAbsence).toHaveBeenCalledWith("pending-1");
  });
});
