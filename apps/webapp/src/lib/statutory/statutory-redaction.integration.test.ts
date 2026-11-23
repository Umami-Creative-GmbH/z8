/**
 * #1988: scoped managers, planners and employees never see wages, EUR amounts or external
 * earnings in statutory findings or EUR baselines; org admins see the full detail. The audience
 * comes from the real settings-access rule (ADR 0002) against membership and employee rows.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { type StatutoryFinding, statutoryFindingId } from "./finding";
import {
	loadStatutoryAudience,
	redactStatutoryFindings,
	redactStatutoryThresholds,
} from "./redaction";
import { loadStatutoryThresholds } from "./thresholds";

describe("statutory wage redaction (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const fx = statutoryFixture(integrationAdminPool(), "t1988-redaction");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	function minijobFinding(organizationId: string, employeeId: string): StatutoryFinding {
		return {
			id: statutoryFindingId("minijob_monthly_cap", employeeId, "2026-03"),
			organizationId,
			employeeId,
			domain: "minijob",
			kind: "minijob_monthly_cap",
			severity: "warning",
			subjectKey: "2026-03",
			periodStart: "2026-03-01",
			periodEnd: "2026-04-01",
			legalReference: "§ 8 Abs. 1 Nr. 1 SGB IV",
			summary: { tier: "warning", usedPercent: 86 },
			adminDetail: {
				currency: "EUR",
				amountsCents: { earned: 41_200, planned: 9_000, cap: 60_300 },
				hourlyWageCents: 1_500,
				externalEarningsCents: 2_000,
			},
			inputFingerprint: "v1:abc",
			acknowledgementKind: "minijob_unforeseeable_exceedance",
			acknowledgement: {
				status: "current",
				acknowledgedAt: new Date("2026-03-20T10:00:00Z"),
				acknowledgedBy: "admin-user",
				reason: "Paid 15 EUR/h for the extra shift",
			},
		};
	}

	async function organizationWithRoles() {
		const org = await fx.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		const orgAdmin = await fx.user("org-admin");
		await fx.membership(org, orgAdmin, "admin");
		const manager = await fx.employee(org, "manager", { role: "manager" });
		await fx.membership(org, manager, "member");
		const worker = await fx.employee(org, "worker");
		await fx.membership(org, worker, "member");
		const outsider = await fx.user("outsider");
		return { org, owner, orgAdmin, manager, worker, outsider };
	}

	it("shows org admins and owners the full EUR detail", async () => {
		const { org, owner, orgAdmin, worker } = await organizationWithRoles();
		const finding = minijobFinding(org.id, worker.employeeId);

		for (const viewer of [owner, orgAdmin]) {
			const audience = await loadStatutoryAudience(db, {
				organizationId: org.id,
				userId: viewer.userId,
			});
			expect(audience).toBe("full");
			expect(redactStatutoryFindings([finding], audience)).toEqual([finding]);
		}
	});

	it("gives scoped managers, employees and outsiders the wage-free summary only", async () => {
		const { org, manager, worker, outsider } = await organizationWithRoles();
		const finding = minijobFinding(org.id, worker.employeeId);

		for (const viewer of [manager, worker, outsider]) {
			const audience = await loadStatutoryAudience(db, {
				organizationId: org.id,
				userId: viewer.userId,
			});
			expect(audience).toBe("restricted");
			const [redacted] = redactStatutoryFindings([finding], audience);
			expect(redacted).toEqual({
				...finding,
				adminDetail: null,
				acknowledgement: {
					status: "current",
					acknowledgedAt: finding.acknowledgement?.acknowledgedAt,
				},
			});
			expect(JSON.stringify(redacted)).not.toMatch(/41200|60300|1500|EUR\/h/);
		}
	});

	it("hides EUR baselines from restricted viewers but keeps time and day limits", async () => {
		const { org, manager } = await organizationWithRoles();
		const audience = await loadStatutoryAudience(db, {
			organizationId: org.id,
			userId: manager.userId,
		});
		const table = await loadStatutoryThresholds(db, {
			keys: ["de_minijob_monthly_limit_cents", "de_short_term_max_work_days_per_year"],
			from: "2026-01-01",
			until: "2026-02-01",
		});
		const rows = [
			...table.rows("de_minijob_monthly_limit_cents"),
			...table.rows("de_short_term_max_work_days_per_year"),
		];

		expect(redactStatutoryThresholds(rows, audience).map((row) => row.key)).toEqual([
			"de_short_term_max_work_days_per_year",
		]);
		expect(redactStatutoryThresholds(rows, "full")).toHaveLength(2);
	});
});
