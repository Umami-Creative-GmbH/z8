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
});
