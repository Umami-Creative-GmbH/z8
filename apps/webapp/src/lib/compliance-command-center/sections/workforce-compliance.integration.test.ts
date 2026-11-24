/**
 * #1994: the Compliance Command Center's `workforceCompliance` section aggregates the statutory
 * monitors (real PostgreSQL): severity rollups per domain, pending and stale acknowledgements, and
 * deep links into Settings → Contracts → Reviews & Conflicts with the domain preselected. Counts
 * only, scoped to the organization.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	STATUTORY_DOMAINS_NOW as now,
	statutoryDomainsFixture,
} from "@/lib/statutory/__tests__/statutory-domains-fixture";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { getWorkforceComplianceSection } from "./workforce-compliance";

describe("Compliance Command Center workforce compliance with statutory monitors (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1994-ccc");
	const domains = statutoryDomainsFixture(admin, fx);

	beforeEach(async () => {
		await fx.cleanup();
		domains.reset();
	});
	afterAll(fx.cleanup);

	it("rolls up open statutory findings per domain with deep links into Reviews & Conflicts", async () => {
		const seed = await domains.seed("a");

		const section = await getWorkforceComplianceSection(seed.org.id, { now });

		expect(section.card.status).toBe("critical");
		expect(section.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.statutoryFindings",
			// Minijob, working student and youth are critical; short-term, on-call (×5: four weeks
			// below the call-off band and the short notice) and the apprentice conflict warn.
			params: { critical: 3, warning: 7 },
		});
		expect(section.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.statutoryAcknowledgements",
			params: { pending: 5, stale: 0 },
		});
		expect(section.card.links).toEqual([
			{
				label: {
					key: "compliance.commandCenter.links.statutoryDomain.minijob",
					params: { count: 1 },
				},
				href: "/settings/contracts?tab=reviews&domain=minijob",
			},
			{
				label: {
					key: "compliance.commandCenter.links.statutoryDomain.short_term",
					params: { count: 1 },
				},
				href: "/settings/contracts?tab=reviews&domain=short_term",
			},
			{
				label: {
					key: "compliance.commandCenter.links.statutoryDomain.working_student",
					params: { count: 1 },
				},
				href: "/settings/contracts?tab=reviews&domain=working_student",
			},
			{
				label: {
					key: "compliance.commandCenter.links.statutoryDomain.on_call",
					params: { count: 5 },
				},
				href: "/settings/contracts?tab=reviews&domain=on_call",
			},
			{
				label: {
					key: "compliance.commandCenter.links.statutoryDomain.youth_apprentice",
					params: { count: 2 },
				},
				href: "/settings/contracts?tab=reviews&domain=youth_apprentice",
			},
		]);
		expect(section.recentCriticalEvents).toContainEqual(
			expect.objectContaining({
				id: "statutory-minijob",
				sectionKey: "workforceCompliance",
				severity: "critical",
				title: { key: "compliance.commandCenter.events.statutory.minijob.title" },
				description: {
					key: "compliance.commandCenter.events.statutory.description",
					params: { critical: 1, warning: 0, pending: 1, stale: 0 },
				},
				primaryLink: {
					label: { key: "compliance.commandCenter.links.openStatutoryReviews" },
					href: "/settings/contracts?tab=reviews&domain=minijob",
				},
			}),
		);
		expect(section.recentCriticalEvents).toContainEqual(
			expect.objectContaining({ id: "statutory-short_term", severity: "warning" }),
		);
		// Counts only: no amounts, names or employee ids leave the section.
		const payload = JSON.stringify(section);
		expect(payload).not.toMatch(/EUR|€|67500|60300/);
		for (const who of [seed.mini, seed.seasonal, seed.student, seed.caller, seed.minor]) {
			expect(payload).not.toContain(who.employeeId);
		}
	});

	it("counts only its own organization's statutory findings", async () => {
		await domains.seed("a");
		domains.reset();
		const quiet = await fx.organization("quiet");

		const section = await getWorkforceComplianceSection(quiet.id, { now });

		expect(section.card.status).toBe("healthy");
		expect(section.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.statutoryFindings",
			params: { critical: 0, warning: 0 },
		});
		expect(section.card.links ?? []).toEqual([]);
		expect(section.recentCriticalEvents).toEqual([]);
	});
});
