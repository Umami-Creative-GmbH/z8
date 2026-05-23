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
    expect(findNode(tree, (node) => getTextContent(node).includes("Alpha Org"))).toBeTruthy();

    const otherOrganizationButton = findNode(
      tree,
      (node) =>
        node.type === "ListItem" &&
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
        node.type === "ListItem" &&
        getTextContent(node).includes("Beta Org") &&
        node.props.onPress === undefined,
    );

    expect(unavailableOrganizationButton).toBeTruthy();

    unavailableOrganizationButton?.props.onPress?.();

    expect(onSwitchOrganization).not.toHaveBeenCalled();
  });

  it("shows switching state while organization rows are disabled", () => {
    const tree = ProfileScreen({
      activeOrganizationId: "org-1",
      isSigningOut: false,
      isSwitchingOrganization: true,
      onSignOut: vi.fn(),
      onSwitchOrganization: vi.fn(),
      organizations: [
        {
          id: "org-2",
          name: "Beta Org",
          slug: "beta",
          hasEmployeeRecord: true,
        },
      ],
    });

    const switchingOrganizationItem = findNode(
      tree,
      (node) =>
        node.type === "ListItem" &&
        getTextContent(node).includes("Beta Org") &&
        getTextContent(node).includes("Switching organization…"),
    );

    expect(switchingOrganizationItem).toBeTruthy();
    expect(switchingOrganizationItem?.props.onPress).toBeUndefined();
  });

  it("signs out from the Expo UI button and disables it while signing out", () => {
    const onSignOut = vi.fn();

    const tree = ProfileScreen({
      activeOrganizationId: null,
      isSigningOut: false,
      isSwitchingOrganization: false,
      onSignOut,
      onSwitchOrganization: vi.fn(),
      organizations: [],
    });

    const signOutButton = findNode(
      tree,
      (node) => node.type === "Button" && getTextContent(node) === "Sign out",
    );

    expect(signOutButton).toBeTruthy();
    signOutButton?.props.onPress?.();

    expect(onSignOut).toHaveBeenCalledOnce();

    const disabledTree = ProfileScreen({
      activeOrganizationId: null,
      isSigningOut: true,
      isSwitchingOrganization: false,
      onSignOut,
      onSwitchOrganization: vi.fn(),
      organizations: [],
    });
    const disabledSignOutButton = findNode(
      disabledTree,
      (node) => node.type === "Button" && getTextContent(node) === "Sign out",
    );

    expect(disabledSignOutButton?.props.disabled).toBe(true);
    expect(disabledSignOutButton?.props.onPress).toBeUndefined();
  });
});
