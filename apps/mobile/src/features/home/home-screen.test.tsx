import React from "react";

import { HomeScreen } from "./home-screen";

vi.mock("react-native", () => {
  return {
    Pressable: "Pressable",
    StyleSheet: {
      create: <T,>(styles: T) => styles,
    },
    Text: "Text",
    View: "View",
  };
});

function findNode(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any>) => boolean,
): React.ReactElement<any> | null {
  if (!React.isValidElement(node)) {
    return null;
  }

  const element = node as React.ReactElement<any>;

  if (typeof element.type === "function") {
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

  if (typeof element.type === "function") {
    const Component = element.type as (props: any) => React.ReactNode;

    return getTextContent(Component(element.props));
  }

  return React.Children.toArray(element.props.children)
    .map(getTextContent)
    .join("");
}

describe("HomeScreen", () => {
  it("disables clock in until a work location is selected", () => {
    const tree = HomeScreen({
      clock: {
        isClockedIn: false,
        activeWorkPeriod: null,
      },
      today: {
        minutesWorked: 0,
        latestEventLabel: null,
      },
      isSubmitting: false,
      selectedWorkLocation: null,
      onSelectWorkLocation: vi.fn(),
      onClockIn: vi.fn(),
      onClockOut: vi.fn(),
    });

    const clockInButton = findNode(
      tree,
      (node) => node.type === "Pressable" && getTextContent(node).includes("Clock In"),
    );

    expect(clockInButton).toBeTruthy();
    expect(clockInButton?.props.disabled).toBe(true);
  });

  it("keeps the selected location locked while a clock-in submission is pending", () => {
    const onSelectWorkLocation = vi.fn();

    const tree = HomeScreen({
      clock: {
        isClockedIn: false,
        activeWorkPeriod: null,
      },
      today: {
        minutesWorked: 15,
        latestEventLabel: "Clocked out",
      },
      isSubmitting: true,
      selectedWorkLocation: "office",
      onSelectWorkLocation,
      onClockIn: vi.fn(),
      onClockOut: vi.fn(),
    });

    const officeOption = findNode(
      tree,
      (node) =>
        node.type === "Pressable" &&
        node.props.accessibilityState?.selected === true &&
        getTextContent(node).includes("Office"),
    );
    const homeOption = findNode(
      tree,
      (node) => node.type === "Pressable" && getTextContent(node).includes("Home"),
    );

    expect(officeOption).toBeTruthy();
    expect(officeOption?.props.disabled).toBe(true);
    expect(homeOption?.props.disabled).toBe(true);

    officeOption?.props.onPress?.();
    homeOption?.props.onPress?.();

    expect(onSelectWorkLocation).not.toHaveBeenCalled();
  });

  it("shows inline feedback when a clock action fails", () => {
    const tree = HomeScreen({
      clock: {
        isClockedIn: false,
        activeWorkPeriod: null,
      },
      today: {
        minutesWorked: 0,
        latestEventLabel: null,
      },
      errorMessage: "Clock action failed",
      isSubmitting: false,
      selectedWorkLocation: "office",
      onSelectWorkLocation: vi.fn(),
      onClockIn: vi.fn(),
      onClockOut: vi.fn(),
    });

    expect(
      findNode(tree, (node) => getTextContent(node).includes("Clock action failed")),
    ).toBeTruthy();
  });
});
