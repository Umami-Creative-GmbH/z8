import React from "react";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";

const { useMobileSession } = vi.hoisted(() => ({
  useMobileSession: vi.fn(),
}));

vi.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => React.createElement("Redirect", { href }),
}));

vi.mock("react-native", () => ({
  Pressable: "button",
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  Text: "span",
  View: "div",
}));

vi.mock("@/src/features/session/use-mobile-session", () => ({
  useMobileSession,
}));

vi.mock("@/src/features/home/use-home-query", () => ({
  useHomeQuery: vi.fn(() => ({
    data: {
      activeOrganizationId: "org-1",
      clock: { isClockedIn: false, activeWorkPeriod: null },
      today: { minutesWorked: 0, latestEventLabel: null },
    },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
    clockIn: vi.fn().mockResolvedValue(undefined),
    clockOut: vi.fn().mockResolvedValue(undefined),
    isClockSubmitting: false,
  })),
}));

vi.mock("@/src/features/home/home-screen", () => ({
  HomeScreen: () => React.createElement("div", {}, React.createElement("span", {}, "Home screen")),
}));

import HomeRoute from "../../app/(app)/home";

describe("Home route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders no auth redirect while the session query is still loading", () => {
    useMobileSession.mockReturnValue({
      data: null,
      isError: false,
      isLoading: true,
      refetch: vi.fn(),
    });

    const html = renderToStaticMarkup(React.createElement(HomeRoute));

    expect(html).toBe("");
  });

  it("shows the session retry state when the session query errors", () => {
    useMobileSession.mockReturnValue({
      data: null,
      isError: true,
      isLoading: false,
      refetch: vi.fn(),
    });

    const html = renderToStaticMarkup(React.createElement(HomeRoute));

    expect(html).toContain("Try again");
    expect(html).not.toContain("Home screen");
  });

  it("redirects to profile when the session has no active organization", () => {
    useMobileSession.mockReturnValue({
      data: {
        token: "token",
        activeOrganizationId: null,
        organizations: [],
        user: { id: "user-1", name: "User", email: "user@example.com" },
      },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    const html = renderToStaticMarkup(React.createElement(HomeRoute));

    expect(html).toContain("href=\"/(app)/profile\"");
  });
});
