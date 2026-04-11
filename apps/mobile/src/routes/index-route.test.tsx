import React from "react";

const { useMobileSession } = vi.hoisted(() => ({
  useMobileSession: vi.fn(),
}));

vi.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => React.createElement("Redirect", { href }),
}));

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  Text: "Text",
  View: "View",
}));

vi.mock("@/src/features/session/use-mobile-session", () => ({
  useMobileSession,
}));

import Index from "../../app/index";

function getTextContent(node: React.ReactNode): string {
  if (typeof node === "string") {
    return node;
  }

  if (!React.isValidElement(node)) {
    return "";
  }

  return React.Children.toArray((node as React.ReactElement<any>).props.children)
    .map(getTextContent)
    .join("");
}

function resolveTree(node: React.ReactNode): React.ReactNode {
  if (!React.isValidElement(node)) {
    return node;
  }

  if (typeof node.type === "function") {
    return resolveTree((node.type as (props: any) => React.ReactNode)(node.props));
  }

  const element = node as React.ReactElement<any>;

  return React.cloneElement(
    element,
    element.props,
    ...React.Children.toArray(element.props.children).map(resolveTree),
  );
}

describe("Index route", () => {
  it("shows a retry state instead of redirecting when the session query fails", () => {
    useMobileSession.mockReturnValue({
      data: null,
      error: new Error("network"),
      isError: true,
      isLoading: false,
      refetch: vi.fn(),
    });

    const tree = resolveTree(Index());

    expect(React.isValidElement(tree)).toBe(true);
    expect((tree as React.ReactElement).type).not.toBe("Redirect");
    expect(getTextContent(tree)).toContain("Try again");
  });
});
