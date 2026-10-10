import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { isPayrollRunPreviewOpen } from "./payroll-run-preview";
import { getReimbursementChannel, saveReimbursementChannel } from "./reimbursement-channel";

describe("reimbursement channel on PostgreSQL (#849)", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	async function setPreview(organizationId: string, mode: "inactive" | "active") {
		await fixture.pool.query(
			`insert into travel_expense_payroll_run_preview_control (organization_id, mode)
			 values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode`,
			[organizationId, mode],
		);
	}

	async function channelAudits(organizationId: string) {
		const { rows } = await fixture.pool.query<{ changes: string; performed_by: string }>(
			`select changes, performed_by from audit_log
			 where organization_id = $1 and action = 'travel_expense.reimbursement_channel_changed'
			 order by timestamp`,
			[organizationId],
		);
		return rows.map((row) => ({ by: row.performed_by, changes: JSON.parse(row.changes) }));
	}

	it("reads bank transfer for organizations without settings and with settings saved before the channel", async () => {
		const withoutSettings = await fixture.createOrganization();
		const withSettings = await fixture.createOrganization();
		await fixture.pool.query(
			"insert into travel_expense_settings (organization_id, reimbursement_currency) values ($1, 'CHF')",
			[withSettings],
		);

		expect(await getReimbursementChannel(withoutSettings, { database: fixture.db })).toBe(
			"bank_transfer",
		);
		expect(await getReimbursementChannel(withSettings, { database: fixture.db })).toBe(
			"bank_transfer",
		);
	});

	it("refuses the payroll run while the preview gate is closed", async () => {
		const organizationId = await fixture.createOrganization();

		expect(
			await saveReimbursementChannel(
				{ organizationId, actorUserId: fixture.ownerUserId, channel: "payroll_run" },
				{ database: fixture.db },
			),
		).toEqual({ kind: "preview_closed" });
		expect(await getReimbursementChannel(organizationId, { database: fixture.db })).toBe(
			"bank_transfer",
		);
		expect(await channelAudits(organizationId)).toEqual([]);
	});

	it("opens the preview gate only for an organization whose control row is active", async () => {
		const withoutRow = await fixture.createOrganization();
		const inactive = await fixture.createOrganization();
		const active = await fixture.createOrganization();
		await setPreview(inactive, "inactive");
		await setPreview(active, "active");
		const database = fixture.db;

		expect(await isPayrollRunPreviewOpen(withoutRow, { database })).toBe(false);
		expect(await isPayrollRunPreviewOpen(inactive, { database })).toBe(false);
		expect(await isPayrollRunPreviewOpen(active, { database })).toBe(true);

		const save = (organizationId: string) =>
			saveReimbursementChannel(
				{ organizationId, actorUserId: fixture.ownerUserId, channel: "payroll_run" },
				{ database },
			);
		expect(await save(inactive)).toEqual({ kind: "preview_closed" });
		expect(await save(active)).toEqual({
			kind: "saved",
			channel: "payroll_run",
			previous: "bank_transfer",
		});
	});

	it("refuses an unknown channel", async () => {
		const organizationId = await fixture.createOrganization();

		expect(
			await saveReimbursementChannel(
				{ organizationId, actorUserId: fixture.ownerUserId, channel: "cash" },
				{ database: fixture.db },
			),
		).toEqual({ kind: "invalid" });
	});

	it("saves one organization's channel, keeps its other settings, and audits old and new value", async () => {
		const organizationId = await fixture.createOrganization();
		const other = await fixture.createOrganization();
		await fixture.pool.query(
			"insert into travel_expense_settings (organization_id, reimbursement_currency) values ($1, 'CHF')",
			[organizationId],
		);
		await setPreview(organizationId, "active");
		const deps = { database: fixture.db };

		expect(
			await saveReimbursementChannel(
				{ organizationId, actorUserId: fixture.ownerUserId, channel: "payroll_run" },
				deps,
			),
		).toEqual({ kind: "saved", channel: "payroll_run", previous: "bank_transfer" });
		expect(await getReimbursementChannel(organizationId, { database: fixture.db })).toBe(
			"payroll_run",
		);
		expect(await getReimbursementChannel(other, { database: fixture.db })).toBe("bank_transfer");
		const { rows } = await fixture.pool.query<{ currency: string }>(
			"select reimbursement_currency as currency from travel_expense_settings where organization_id = $1",
			[organizationId],
		);
		expect(rows).toEqual([{ currency: "CHF" }]);

		// After the gate closes again, keeping and leaving the payroll run are both allowed.
		await setPreview(organizationId, "inactive");
		expect(
			await saveReimbursementChannel(
				{ organizationId, actorUserId: fixture.ownerUserId, channel: "payroll_run" },
				deps,
			),
		).toEqual({ kind: "unchanged", channel: "payroll_run" });
		expect(
			await saveReimbursementChannel(
				{ organizationId, actorUserId: fixture.ownerUserId, channel: "bank_transfer" },
				deps,
			),
		).toEqual({ kind: "saved", channel: "bank_transfer", previous: "payroll_run" });
		expect(
			await saveReimbursementChannel(
				{ organizationId, actorUserId: fixture.ownerUserId, channel: "bank_transfer" },
				deps,
			),
		).toEqual({ kind: "unchanged", channel: "bank_transfer" });

		expect(await channelAudits(organizationId)).toEqual([
			{
				by: fixture.ownerUserId,
				changes: {
					from: { reimbursementChannel: "bank_transfer" },
					to: { reimbursementChannel: "payroll_run" },
				},
			},
			{
				by: fixture.ownerUserId,
				changes: {
					from: { reimbursementChannel: "payroll_run" },
					to: { reimbursementChannel: "bank_transfer" },
				},
			},
		]);
		expect(await channelAudits(other)).toEqual([]);
	});

	it("creates the settings row of an organization that never saved settings", async () => {
		const organizationId = await fixture.createOrganization();
		await setPreview(organizationId, "active");

		await saveReimbursementChannel(
			{ organizationId, actorUserId: fixture.ownerUserId, channel: "payroll_run" },
			{ database: fixture.db },
		);

		const { rows } = await fixture.pool.query(
			"select reimbursement_channel, reimbursement_currency, updated_by from travel_expense_settings where organization_id = $1",
			[organizationId],
		);
		expect(rows).toEqual([
			{
				reimbursement_channel: "payroll_run",
				reimbursement_currency: "EUR",
				updated_by: fixture.ownerUserId,
			},
		]);
	});

	it("rejects a channel outside the check constraint", async () => {
		const organizationId = await fixture.createOrganization();
		await expect(
			fixture.pool.query(
				"insert into travel_expense_settings (organization_id, reimbursement_channel) values ($1, 'cash')",
				[organizationId],
			),
		).rejects.toThrow(/travel_expense_settings_reimbursement_channel_check/);
	});
});
