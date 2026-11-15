// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { InfoFooter } from "@/components/info-footer";
import LicensesPage from "./page";

vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("not found");
	},
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_, key: string) =>
				String(values?.[key] ?? key),
			),
	}),
}));
// Navigation/translation and generated input are external boundaries; the route,
// header, record renderer and F2 toolbar remain assembled and real.
vi.mock("@/navigation", () => ({
	Link: ({
		href,
		locale = "de",
		...props
	}: ComponentProps<"a"> & { locale?: string }) => (
		<a {...props} href={`/${locale}${href}`} />
	),
}));
vi.mock("@/data/licenses.json", () => ({
	default: [
		{
			name: "alpha",
			version: "1.2.3",
			license: "MIT",
			repository: { url: "git+https://github.com/example/alpha.git" },
			homepage: "https://alpha.example.test",
		},
		{
			name: "beta",
			version: "2.0.0",
			license: "Apache-2.0",
			repository: "example/beta",
			homepage: "https://github.com/example/beta",
		},
		{ name: "@example/long-package-identity", version: "3.0.0", license: "" },
	],
}));

async function report() {
	const page = LicensesPage({ params: Promise.resolve({ locale: "de" }) });
	render(
		<>
			{await page.props.children.type(page.props.children.props)}
			<InfoFooter />
		</>,
	);
}

describe("public licenses report", () => {
	it("reads actual assembled records and recovers from a no-match search without signing in", async () => {
		const user = userEvent.setup();
		await report();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Open Source Licenses",
		);
		expect(screen.getByText("3 packages")).toBeTruthy();
		expect(screen.getByText("3 license types")).toBeTruthy();
		const search = screen.getByRole("textbox", {
			name: "Search packages or licenses…",
		});
		await user.type(search, "missing-package");
		expect(screen.getByText("No packages found.")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Clear search" }));
		expect(screen.getByText("alpha")).toBeTruthy();
		expect(screen.getByText("beta")).toBeTruthy();
		expect(screen.getByText("Unknown")).toBeTruthy();
		expect(screen.getAllByRole("row")).toHaveLength(4);
	});

	it.each([
		["package", "ALPHA", "alpha", "beta"],
		["license", "apache", "beta", "alpha"],
	])(
		"searches by %s while retaining whole-report totals",
		async (_field, query, visible, hidden) => {
			const user = userEvent.setup();
			await report();
			await user.type(screen.getByRole("textbox"), query);
			expect(screen.getByText(visible)).toBeTruthy();
			expect(screen.queryByText(hidden)).toBeNull();
			expect(screen.getByText("3 packages")).toBeTruthy();
			expect(screen.getByText("3 license types")).toBeTruthy();
		},
	);

	it("retains source destinations, safe new-tab semantics, missing links and locale information links", async () => {
		await report();
		const alpha = screen.getByRole("row", { name: /alpha MIT/ });
		const repo = within(alpha).getByRole("link", { name: "Repository" });
		expect(repo.getAttribute("href")).toBe("https://github.com/example/alpha");
		expect(
			within(alpha)
				.getByRole("link", { name: "Homepage" })
				.getAttribute("href"),
		).toBe("https://alpha.example.test");
		for (const link of within(alpha).getAllByRole("link")) {
			expect(link.getAttribute("target")).toBe("_blank");
			expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		}
		const beta = screen.getByRole("row", { name: /beta Apache/ });
		expect(within(beta).getAllByRole("link")).toHaveLength(1);
		expect(within(beta).getByRole("link").getAttribute("href")).toBe(
			"https://github.com/example/beta",
		);
		const unknown = screen.getByRole("row", {
			name: /@example\/long-package-identity Unknown/,
		});
		expect(within(unknown).queryByRole("link")).toBeNull();
		expect(
			screen.getByRole("link", { name: "Back to login" }).getAttribute("href"),
		).toBe("/de/sign-in");
		expect(
			screen
				.getByRole("link", { name: "Open Source Licenses" })
				.getAttribute("href"),
		).toBe("/de/licenses");
		expect(
			screen
				.getByRole("link", { name: "Terms of Service" })
				.getAttribute("href"),
		).toBe("https://www.z8-time.app/terms-app");
		expect(
			screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"),
		).toBe("https://www.z8-time.app/privacy-app");
		expect(screen.getByRole("link", { name: "Trust Center" })).toBeTruthy();
	});

	it("sorts the assembled records by package and license in both directions", async () => {
		const user = userEvent.setup();
		await report();
		const names = () =>
			screen
				.getAllByRole("row")
				.slice(1)
				.map((row) => within(row).getAllByRole("cell")[0].textContent);
		expect(names()).toEqual([
			"@example/long-package-identity",
			"alpha",
			"beta",
		]);
		await user.click(screen.getByRole("button", { name: "Package" }));
		expect(names()).toEqual([
			"beta",
			"alpha",
			"@example/long-package-identity",
		]);
		await user.click(screen.getByRole("button", { name: "Package" }));
		expect(names()).toEqual([
			"@example/long-package-identity",
			"alpha",
			"beta",
		]);
		await user.click(screen.getByRole("button", { name: "License" }));
		expect(names()).toEqual([
			"@example/long-package-identity",
			"beta",
			"alpha",
		]);
		await user.click(screen.getByRole("button", { name: "License" }));
		expect(names()).toEqual([
			"alpha",
			"beta",
			"@example/long-package-identity",
		]);
	});
});
