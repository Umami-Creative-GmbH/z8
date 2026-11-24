/**
 * #1994: the Compliance Command Center's `workforceCompliance` section aggregates the statutory
 * monitors (real PostgreSQL): severity rollups per domain, pending and stale acknowledgements, and
 * deep links into Settings → Contracts → Reviews & Conflicts with the domain preselected. Counts
 * only, scoped to the organization.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { acknowledgeMinijobExceedance } from "@/lib/statutory/minijob/acknowledge-minijob-exceedance";
import { loadMinijobExceedanceReviews } from "@/lib/statutory/minijob/minijob-reviews";
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
					label: { key: "compliance.commandCenter.links.reviewDomain.minijob" },
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

	it("counts a Minijob month acknowledged before it became a third exceedance as critical", async () => {
		const seed = await domains.seed("a");
		const organizationId = seed.org.id;
		await domains.monthWork(seed.org, seed.mini, "2026-03", 2700);
		const [march] = (await loadMinijobExceedanceReviews(db, { organizationId, now })).filter(
			(review) => review.month === "2026-03",
		);
		await acknowledgeMinijobExceedance(db, {
			organizationId,
			actorUserId: seed.owner.userId,
			employeeId: seed.mini.employeeId,
			month: "2026-03",
			reason: "Covered a sick colleague",
			expectedFingerprint: march.inputFingerprint,
			expectedTotalCents: march.totalCents,
			now,
		});
		await domains.monthWork(seed.org, seed.mini, "2026-01", 2700);
		await domains.monthWork(seed.org, seed.mini, "2026-02", 2700);

		const section = await getWorkforceComplianceSection(organizationId, { now });

		// January, February, March (the third, documented before) and November.
		expect(section.recentCriticalEvents).toContainEqual(
			expect.objectContaining({
				id: "statutory-minijob",
				severity: "critical",
				description: {
					key: "compliance.commandCenter.events.statutory.description",
					params: { critical: 4, warning: 0, pending: 2, stale: 0 },
				},
			}),
		);
	});

	it("counts a Minijob exceedance planned in the last month of the planning horizon", async () => {
		const seed = await domains.seed("a");
		// 18 November + 8 weeks reaches 13 January 2027: six 8-hour January shifts, 720 EUR.
		for (const date of ["04", "05", "06", "07", "08", "11"]) {
			await domains.shift(seed.org, {
				employeeId: seed.mini.employeeId,
				date: `2027-01-${date}`,
				startTime: "08:00",
				endTime: "16:00",
			});
		}

		const section = await getWorkforceComplianceSection(seed.org.id, { now });

		expect(section.card.links).toContainEqual({
			label: {
				key: "compliance.commandCenter.links.statutoryDomain.minijob",
				params: { count: 2 },
			},
			href: "/settings/contracts?tab=reviews&domain=minijob",
		});
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
