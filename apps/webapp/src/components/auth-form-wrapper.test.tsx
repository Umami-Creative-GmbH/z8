/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

vi.mock("next/image", () => ({
	default: ({ alt, src }: { alt: string; src: string }) => (
		<img alt={alt} src={src} />
	),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

import { AuthFormWrapper } from "./auth-form-wrapper";

describe("AuthFormWrapper", () => {
	it("names the task as the main heading with or without organization artwork", () => {
		const page = render(
			<AuthFormWrapper title="Sign in">
				<input aria-label="Email" defaultValue="draft@example.com" />
			</AuthFormWrapper>,
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "Sign in" }),
		).toBeTruthy();
		page.rerender(
			<AuthFormWrapper
				title="Verify your email"
				branding={{
					appName: "Acme Time",
					logoUrl: "https://example.com/logo.png",
				}}
			>
				<input aria-label="Email" defaultValue="draft@example.com" />
			</AuthFormWrapper>,
		);
		expect(
			screen
				.getAllByRole("heading", { level: 1 })
				.map((heading) => heading.textContent),
		).toEqual(["Verify your email"]);
		expect(screen.getByAltText("Acme Time logo")).toBeTruthy();
		expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
			"draft@example.com",
		);
		expect(
			screen.queryByRole("link", { name: /dashboard|settings/i }),
		).toBeNull();
	});
	it("renders a focused auth card without the legacy image panel", () => {
		render(
			<AuthFormWrapper title="Create your account">
				<div>form body</div>
			</AuthFormWrapper>,
		);

		expect(screen.getByText("z8")).toBeTruthy();
		expect(screen.getByText("Create your account")).toBeTruthy();
		expect(screen.getByText("form body")).toBeTruthy();
		expect(screen.queryByAltText(/background image/i)).toBeNull();
	});

	it("renders organization branding without adding a layout image", () => {
		render(
			<AuthFormWrapper
				title="Welcome back"
				branding={{
					appName: "Acme Time",
					logoUrl: "https://example.com/logo.png",
					primaryColor: "#2563eb",
					backgroundImageUrl: "https://example.com/background.jpg",
				}}
			>
				<div>branded form</div>
			</AuthFormWrapper>,
		);

		expect(screen.getByAltText("Acme Time logo")).toBeTruthy();
		expect(screen.getByText("Welcome back")).toBeTruthy();
		expect(screen.getByText("branded form")).toBeTruthy();
		expect(screen.queryByAltText("Acme Time background")).toBeNull();
	});

	it("preserves the build reference, return destination and form transport", () => {
		const { container } = render(
			<AuthFormWrapper
				title="Join workspace"
				buildHash="build-123"
				backHref="/sign-in?callbackUrl=%2Fcalendar"
				formProps={{ action: "/auth/join", method: "post" }}
			>
				<div>join form</div>
			</AuthFormWrapper>,
		);

		expect(screen.getByText("Version build-123")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Back to login" }).getAttribute("href"),
		).toBe("/sign-in?callbackUrl=%2Fcalendar");
		expect(container.querySelector("form")?.getAttribute("action")).toBe(
			"/auth/join",
		);
		expect(container.querySelector("form")?.getAttribute("method")).toBe(
			"post",
		);
	});
});
