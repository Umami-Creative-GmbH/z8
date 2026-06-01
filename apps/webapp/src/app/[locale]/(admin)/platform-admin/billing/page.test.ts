import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("platform admin billing page translations", () => {
	it("does not render billing dashboard copy as hardcoded literals", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain("getTranslate");
		for (const literal of [
			"Billing Dashboard",
			"Monitor subscriptions, revenue, and payment status",
			"Revenue Metrics",
			"Recent Subscriptions",
			"Monthly recurring revenue",
			"Active Subscriptions",
			"No subscriptions yet",
		]) {
			expect(source).not.toContain(`>${literal}<`);
		}
	});

	it("defines translated subscription seat count table labels", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain('t("admin:admin.billing.table.licensedSeats", "Licensed seats")');
		expect(source).toContain('t("admin:admin.billing.table.usedSeats", "Used seats")');
		expect(source).toContain('t("admin:admin.billing.table.demoUsers", "Demo users")');
		expect(source).not.toContain('t("admin:admin.billing.table.seats", "Seats")');
	});

	it("queries organization-scoped used and demo seat counts", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain("member.organizationId");
		expect(source).toContain("inArray(member.organizationId");
		expect(source).toContain('eq(member.status, "approved")');
		expect(source).toContain('notLike(user.email, "%@demo.invalid")');
		expect(source).toContain('like(user.email, "%@demo.invalid")');
	});

	it("queries only organizations for the displayed subscriptions", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain("inArray(organization.id, organizationIds)");
		expect(source).not.toContain("allOrgs");
	});

	it("labels the sync action column for screen readers", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain('t("admin:admin.billing.table.actions", "Actions")');
		expect(source).toContain('className="sr-only"');
	});
});

describe("platform admin billing seat sync button source", () => {
	it("renders a row-level sync action with organization context", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain('import { SyncSeatsButton } from "./sync-seats-button"');
		expect(source).toContain("<SyncSeatsButton");
		expect(source).toContain("organizationId={sub.organizationId}");
		expect(source).toContain("organizationName={orgName}");
		expect(source).toContain("colSpan={9}");
	});

	it("defines a client button that syncs seats and refreshes the route", () => {
		const source = readFileSync(new URL("./sync-seats-button.tsx", import.meta.url), "utf8");

		expect(source).toContain("'use client'");
		expect(source).toContain("IconRefresh");
		expect(source).toContain("syncOrganizationSeatsAction(organizationId)");
		expect(source).toContain("router.refresh()");
		expect(source).toContain("useTransition");
		expect(source).toContain("organizationName");
	});
});
