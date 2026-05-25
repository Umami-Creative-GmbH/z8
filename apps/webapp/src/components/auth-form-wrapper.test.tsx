/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("next/image", () => ({
	default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

import { AuthFormWrapper } from "./auth-form-wrapper";

describe("AuthFormWrapper", () => {
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

	it("uses mobile-friendly card spacing before desktop card polish", () => {
		const { container } = render(
			<AuthFormWrapper title="Join workspace" buildHash="build-123">
				<div>join form</div>
			</AuthFormWrapper>,
		);

		const wrapper = container.firstElementChild;
		const card = wrapper?.firstElementChild;
		const cardContent = card?.firstElementChild;

		expect(wrapper?.className).toContain("max-w-md");
		expect(card?.className).toContain("bg-white/20");
		expect(card?.className).toContain("dark:bg-slate-950/45");
		expect(card?.className).toContain("backdrop-blur-md");
		expect(card?.className).toContain("relative");
		expect(card?.className).toContain("sm:shadow-xl");
		expect(cardContent?.className).toContain("p-5");
		expect(cardContent?.className).toContain("sm:p-8");
		expect(screen.getByText("Version build-123").className).toContain("right-3");
		expect(screen.getByText("Version build-123").className).toContain("bottom-1.5");
	});
});
