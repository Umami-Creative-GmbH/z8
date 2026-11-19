import { existsSync } from "node:fs";
import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";

const locale = process.env.Z8_INSTANT_NAV_LOCALE || "en";
const routes = [
	{ path: "/time-tracking", source: "/", marker: "time-tracking" },
	{ path: "/", source: "/time-tracking", marker: "dashboard" },
	{ path: "/team", source: "/", marker: "team" },
	{ path: "/settings/employees", source: "/settings", marker: "employees" },
] as const;

function localized(path: string) {
	return `/${locale}${path === "/" ? "" : path}`;
}

test.beforeAll(async ({ request, baseURL }) => {
	expect(
		baseURL,
		"Set Z8_INSTANT_NAV_BASE_URL to the isolated production test server",
	).toBeTruthy();
	const origin = new URL(baseURL!);
	expect(["127.0.0.1", "localhost", "[::1]"]).toContain(origin.hostname);
	expect(
		process.env.Z8_INSTANT_NAV_STORAGE_STATE,
		"Supply a private admin test-account storageState path",
	).toBeTruthy();
	expect(existsSync(process.env.Z8_INSTANT_NAV_STORAGE_STATE!)).toBe(true);
	expect(
		process.env.Z8_INSTANT_NAV_BUILD_HASH,
		"Pin the exact test build's expected buildHash",
	).toBeTruthy();
	const version = await request.get("/api/app-version");
	expect(version.ok()).toBe(true);
	expect((await version.json()).buildHash).toBe(process.env.Z8_INSTANT_NAV_BUILD_HASH);
});

for (const route of routes) {
	test(`${route.marker}: hard load serves the application shell with protected data held`, async ({
		page,
		baseURL,
	}) => {
		const destination = localized(route.path);
		await instant(
			page,
			async () => {
				await page.goto(destination);
				await expect(page.getByTestId("application-shell")).toBeVisible();
				await expect(page.getByTestId(`${route.marker}-content`)).toHaveCount(0);
			},
			{ baseURL },
		);
		// A held document does not resume its stream. A new unlocked request verifies admission/content.
		await page.reload();
		await expect(page).toHaveURL(new URL(destination, baseURL).href);
		await expect(page.getByTestId(`${route.marker}-content`)).toBeVisible();
	});

	test(`${route.marker}: a sibling Link commits its local loading UI under the lock`, async ({
		page,
	}) => {
		const destination = localized(route.path);
		await page.goto(localized(route.source));
		const href = page.locator(`a[href="${destination}"]:visible`).first();
		if (
			test.info().project.name === "mobile" &&
			(await href.count()) === 0 &&
			route.source !== "/settings"
		) {
			await page.locator('[data-sidebar="trigger"]').first().click();
		}
		await expect(href).toBeVisible();
		await page.evaluate(() =>
			Object.defineProperty(window, "__z8InstantNavigation", { value: true }),
		);
		await instant(page, async () => {
			await href.click();
			await expect(page.getByTestId(`${route.marker}-shell`)).toBeVisible();
			await expect(page.getByTestId(`${route.marker}-content`)).toHaveCount(0);
			expect(await page.evaluate(() => "__z8InstantNavigation" in window)).toBe(true);
		});
		await expect(page.getByTestId(`${route.marker}-content`)).toBeVisible();
		await expect(page).toHaveURL(new URL(destination, page.url()).href);
	});
}
