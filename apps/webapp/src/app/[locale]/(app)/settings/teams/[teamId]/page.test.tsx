/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { use } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("./team-detail-page-client", () => ({
	TeamDetailPageClient: ({
		params,
	}: {
		params: Promise<{ teamId: string }>;
	}) => {
		use(params);
		return <div>Team detail</div>;
	},
}));

const { default: TeamDetailPage } = await import("./page");

describe("TeamDetailPage route boundary", () => {
	it("renders the settings fallback while params remain unresolved", () => {
		const page = TeamDetailPage({ params: new Promise<never>(() => {}) });

		expect(page).not.toBeInstanceOf(Promise);
		render(page);

		expect(screen.getByLabelText("Loading settings")).toBeTruthy();
	});

	it("keeps params consumption in the client implementation", () => {
		const routeDirectory = resolve(
			process.cwd(),
			"src/app/[locale]/(app)/settings/teams/[teamId]",
		);
		const pageSource = readFileSync(
			resolve(routeDirectory, "page.tsx"),
			"utf8",
		);
		const clientSource = readFileSync(
			resolve(routeDirectory, "team-detail-page-client.tsx"),
			"utf8",
		);

		expect(pageSource).not.toMatch(/^\s*["']use client["'];/);
		expect(pageSource).toContain(
			"<Suspense fallback={<SettingsContentLoading />}>",
		);
		expect(pageSource).toContain("<TeamDetailPageClient params={params} />");
		expect(pageSource).not.toContain("use(params)");
		expect(clientSource).toMatch(/^\s*["']use client["'];/);
		expect(clientSource).toContain("export function TeamDetailPageClient");
		expect(clientSource).toContain("use(params)");
	});
});
