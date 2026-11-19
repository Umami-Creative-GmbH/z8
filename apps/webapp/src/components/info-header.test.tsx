/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import { InfoHeader } from "./info-header";

vi.mock("@/navigation", () => ({
	Link: ({
		children,
		href,
		locale,
	}: {
		children: ReactNode;
		href: string;
		locale: string;
	}) => <a href={`/${locale}${href}`}>{children}</a>,
}));

it("names the public information task and keeps its locale-specific return destination", () => {
	render(
		<InfoHeader
			titleKey="info.licenses"
			titleDefault="Open Source Licenses"
			locale="de"
		/>,
	);
	expect(
		screen.getByRole("heading", { level: 1, name: "Open Source Licenses" }),
	).toBeTruthy();
	expect(
		screen.getByRole("link", { name: "Back to login" }).getAttribute("href"),
	).toBe("/de/sign-in");
	expect(
		screen.queryByRole("link", { name: /dashboard|settings/i }),
	).toBeNull();
});
