import { Children, type ReactElement, type ReactNode, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthenticatedAppContent } from "./app-layout-content";
import { AuthenticatedAppShell } from "./app-layout-shell";
import AppLayout from "./layout";

const mockState = vi.hoisted(() => ({
	contentRender: vi.fn(),
	shellRender: vi.fn(),
}));

vi.mock("./app-layout-content", () => ({
	AuthenticatedAppContent: ({
		children,
		params,
	}: {
		children: ReactNode;
		params: Promise<{ locale: string }>;
	}) => {
		mockState.contentRender({ children, params });
		return <section data-testid="authenticated-content">{children}</section>;
	},
}));

vi.mock("./app-layout-shell", () => ({
	AuthenticatedAppShell: () => {
		mockState.shellRender();
		return <div data-testid="authenticated-shell" />;
	},
}));

describe("AppLayout composition", () => {
	it("executes the imported authenticated content inside Suspense with route props", () => {
		const params = Promise.resolve({ locale: "en" });
		const protectedChild = <div>Protected route content</div>;
		const tree = AppLayout({
			children: protectedChild,
			params,
		}) as ReactElement<{
			children: ReactElement<{
				children: ReactNode;
				params: Promise<{ locale: string }>;
			}>;
			fallback: ReactElement;
		}>;

		expect(tree.type).toBe(Suspense);
		expect(tree.props.fallback.type).toBe(AuthenticatedAppShell);

		const contentElement = Children.only(tree.props.children);
		expect(contentElement.type).toBe(AuthenticatedAppContent);
		expect(contentElement.props.params).toBe(params);
		expect(contentElement.props.children).toBe(protectedChild);

		const html = renderToStaticMarkup(tree);

		expect(mockState.contentRender).toHaveBeenCalledTimes(1);
		expect(mockState.contentRender).toHaveBeenCalledWith({
			children: protectedChild,
			params,
		});
		expect(html).toContain("Protected route content");
	});
});
