import React from "react";

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

import { ProfileScreen } from "./profile-screen";

function findNode(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any>) => boolean,
): React.ReactElement<any> | null {
  if (!React.isValidElement(node)) {
    return null;
  }

  const element = node as React.ReactElement<any>;

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

  return React.Children.toArray(element.props.children)
    .map(getTextContent)
    .join("");
}

describe("ProfileScreen", () => {
  it("shows an empty state when no organizations are available", () => {
    const tree = ProfileScreen({
      activeOrganizationId: null,
      isSigningOut: false,
      isSwitchingOrganization: false,
      onSignOut: vi.fn(),
      onSwitchOrganization: vi.fn(),
      organizations: [],
    });

    expect(findNode(tree, (node) => getTextContent(node) === "No organizations available")).toBeTruthy();
  });

  it("shows the active organization and switches when another organization is pressed", () => {
    const onSwitchOrganization = vi.fn();

    const tree = ProfileScreen({
      activeOrganizationId: "org-1",
      isSigningOut: false,
      isSwitchingOrganization: false,
      onSignOut: vi.fn(),
      onSwitchOrganization,
      organizations: [
        {
          id: "org-1",
          name: "Alpha Org",
          slug: "alpha",
          hasEmployeeRecord: true,
        },
        {
          id: "org-2",
          name: "Beta Org",
          slug: "beta",
          hasEmployeeRecord: true,
        },
      ],
    });

    expect(findNode(tree, (node) => getTextContent(node) === "Active organization")).toBeTruthy();
    expect(findNode(tree, (node) => getTextContent(node) === "Alpha Org")).toBeTruthy();

    const otherOrganizationButton = findNode(
      tree,
      (node) =>
        node.type === "Pressable" &&
        getTextContent(node).includes("Beta Org"),
    );

    otherOrganizationButton?.props.onPress?.();

    expect(onSwitchOrganization).toHaveBeenCalledWith("org-2");
  });

  it("does not allow selecting an organization without an employee record", () => {
    const onSwitchOrganization = vi.fn();

    const tree = ProfileScreen({
      activeOrganizationId: "org-1",
      isSigningOut: false,
      isSwitchingOrganization: false,
      onSignOut: vi.fn(),
      onSwitchOrganization,
      organizations: [
        {
          id: "org-1",
          name: "Alpha Org",
          slug: "alpha",
          hasEmployeeRecord: true,
        },
        {
          id: "org-2",
          name: "Beta Org",
          slug: "beta",
          hasEmployeeRecord: false,
        },
      ],
    });

    const unavailableOrganizationButton = findNode(
      tree,
      (node) =>
        node.type === "Pressable" &&
        getTextContent(node).includes("Beta Org") &&
        node.props.disabled === true,
    );

    expect(unavailableOrganizationButton).toBeTruthy();

    unavailableOrganizationButton?.props.onPress?.();

    expect(onSwitchOrganization).not.toHaveBeenCalled();
  });
});
