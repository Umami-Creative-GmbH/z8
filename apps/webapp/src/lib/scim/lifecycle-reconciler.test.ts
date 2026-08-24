import type {
	SCIMProjectedUserState,
	SCIMTransactionContext,
} from "@better-auth/scim";
import { describe, expect, it } from "vitest";
import { reconcileSCIMLifecycle } from "./lifecycle-reconciler";
import { SCIM_MODELS } from "./transaction-store";
import { createTransactionFixture } from "./transaction-store.test-fixture";

const organizationId = "org_target";
const userId = "user_opaque";
const connectionId = "connection_opaque";

function projected(
	active: boolean,
	projectedConnectionId = connectionId,
): SCIMProjectedUserState {
	return {
		provisioningDomainId: organizationId,
		userId,
		active,
		grants: [],
		sources: [
			{
				id: "source_opaque",
				connectionId: projectedConnectionId,
				provisioningDomainId: organizationId,
				active,
			},
		],
	};
}

function fixture(
	options: {
		autoActivate?: boolean;
		deprovisionAction?: "suspend" | "soft_delete";
		member?: Record<string, unknown>;
		employee?: Record<string, unknown>;
	} = {},
) {
	return createTransactionFixture({
		[SCIM_MODELS.providerConfig]: [
			{
				id: "config_opaque",
				organizationId,
				connectionId,
				state: "active",
				autoActivateUsers: options.autoActivate ?? false,
				deprovisionAction: options.deprovisionAction ?? "suspend",
				defaultRoleTemplateId: "template_default",
			},
		],
		[SCIM_MODELS.member]: options.member ? [options.member] : [],
		[SCIM_MODELS.employee]: options.employee ? [options.employee] : [],
	});
}

async function reconcile(
	active: boolean,
	target = fixture(),
	projectedConnectionId = connectionId,
) {
	await reconcileSCIMLifecycle(projected(active, projectedConnectionId), {
		database: target.database,
	} as SCIMTransactionContext);
	return target;
}

describe("reconcileSCIMLifecycle", () => {
	const replacementConnectionId = "connection_replacement";

	async function deactivateThenReplace(
		deprovisionAction: "suspend" | "soft_delete",
	) {
		const target = fixture({
			deprovisionAction,
			member: {
				id: "member_existing",
				organizationId,
				userId,
				role: "member",
				status: "approved",
			},
			employee: {
				id: "employee_existing",
				organizationId,
				userId,
				role: "employee",
				isActive: true,
			},
		});
		await reconcile(false, target);
		(
			target.rows(SCIM_MODELS.providerConfig)[0] as { connectionId: string }
		).connectionId = replacementConnectionId;
		return target;
	}

	it("creates pending inactive membership without a billable revision", async () => {
		const target = await reconcile(true);

		expect(target.rows(SCIM_MODELS.member)).toMatchObject([
			{ organizationId, userId, role: "member", status: "pending" },
		]);
		expect(target.rows(SCIM_MODELS.employee)).toMatchObject([
			{ organizationId, userId, role: "employee", isActive: false },
		]);
		expect(target.rows(SCIM_MODELS.lifecycleState)).toMatchObject([
			{ organizationId, userId, membershipRevision: 0, scimActive: true },
		]);
		expect(target.rows(SCIM_MODELS.seatOutbox)).toHaveLength(0);
	});

	it("creates approved active membership and one deduplicated seat revision", async () => {
		const target = fixture({ autoActivate: true });
		await reconcile(true, target);
		await reconcile(true, target);

		expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
			status: "approved",
		});
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			isActive: true,
		});
		expect(target.rows(SCIM_MODELS.lifecycleState)[0]).toMatchObject({
			membershipRevision: 1,
		});
		expect(target.rows(SCIM_MODELS.seatOutbox)).toMatchObject([
			{
				organizationId,
				userId,
				membershipRevision: 1,
				dedupeKey: `scim-seat:${organizationId}:${userId}:1`,
			},
		]);
		expect(target.rows(SCIM_MODELS.lifecycleAudit)).toHaveLength(1);
		expect(target.rows(SCIM_MODELS.provisioningAudit)).toHaveLength(1);
		for (const model of [
			SCIM_MODELS.employee,
			SCIM_MODELS.lifecycleState,
			SCIM_MODELS.seatOutbox,
		]) {
			const create = target.operations.create.mock.calls.find(
				([query]) => query.model === model,
			)?.[0];
			expect(create).toMatchObject({
				model,
				forceAllowId: true,
				data: { id: expect.stringMatching(/^[0-9a-f-]{36}$/) },
			});
		}
	});

	it("never elevates an existing pending member", async () => {
		const target = fixture({
			autoActivate: true,
			member: {
				id: "member_existing",
				organizationId,
				userId,
				role: "member",
				status: "pending",
			},
			employee: {
				id: "employee_existing",
				organizationId,
				userId,
				role: "employee",
				isActive: false,
			},
		});

		await reconcile(true, target);

		expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
			status: "pending",
		});
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			isActive: false,
		});
		expect(target.rows(SCIM_MODELS.seatOutbox)).toHaveLength(0);
	});

	it.each(["suspend", "soft_delete"] as const)(
		"reverses only its own %s deactivation and restores prior values",
		async (deprovisionAction) => {
			const target = fixture({
				deprovisionAction,
				member: {
					id: "member_existing",
					organizationId,
					userId,
					role: "member",
					status: "approved",
				},
				employee: {
					id: "employee_existing",
					organizationId,
					userId,
					role: "employee",
					isActive: true,
				},
			});

			await reconcile(false, target);
			await reconcile(false, target);
			expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
				status: deprovisionAction === "suspend" ? "suspended" : "approved",
			});
			expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
				isActive: false,
			});
			expect(target.rows(SCIM_MODELS.lifecycleState)[0]).toMatchObject({
				priorMemberStatus: "approved",
				priorEmployeeIsActive: true,
				deactivationOwned: true,
				membershipRevision: 1,
			});

			await reconcile(true, target);
			expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
				status: "approved",
			});
			expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
				isActive: true,
			});
			expect(target.rows(SCIM_MODELS.lifecycleState)[0]).toMatchObject({
				deactivationOwned: false,
				membershipRevision: 2,
			});
			expect(target.rows(SCIM_MODELS.seatOutbox)).toHaveLength(2);
			const restorationUpdates = target.operations.update.mock.calls.map(
				([query]) => query,
			);
			if (deprovisionAction === "suspend") {
				const memberRestore = restorationUpdates.find(
					(query) =>
						query.model === SCIM_MODELS.member &&
						(query.update as { status?: unknown }).status === "approved",
				);
				expect(memberRestore?.where).toEqual(
					expect.arrayContaining([{ field: "status", value: "suspended" }]),
				);
			}
			const employeeRestore = restorationUpdates.find(
				(query) =>
					query.model === SCIM_MODELS.employee &&
					(query.update as { isActive?: unknown }).isActive === true,
			);
			expect(employeeRestore?.where).toEqual(
				expect.arrayContaining([{ field: "isActive", value: false }]),
			);
		},
	);

	it("restores an old suspended lifecycle through the active replacement connection", async () => {
		const target = await deactivateThenReplace("suspend");

		await reconcile(true, target, replacementConnectionId);

		expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
			status: "approved",
		});
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			isActive: true,
		});
		expect(target.rows(SCIM_MODELS.lifecycleState)[0]).toMatchObject({
			connectionId: replacementConnectionId,
			deactivationOwned: false,
			memberDeactivationOwned: false,
			employeeDeactivationOwned: false,
		});
	});

	it("restores an old soft-deleted lifecycle through the active replacement connection", async () => {
		const target = await deactivateThenReplace("soft_delete");

		await reconcile(true, target, replacementConnectionId);

		expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
			status: "approved",
		});
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			isActive: true,
		});
		expect(target.rows(SCIM_MODELS.lifecycleState)[0]).toMatchObject({
			connectionId: replacementConnectionId,
			deactivationOwned: false,
			memberDeactivationOwned: false,
			employeeDeactivationOwned: false,
		});
	});

	it("transfers inactive lifecycle ownership to the replacement connection", async () => {
		const target = await deactivateThenReplace("suspend");

		await reconcile(false, target, replacementConnectionId);

		expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
			status: "suspended",
		});
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			isActive: false,
		});
		expect(target.rows(SCIM_MODELS.lifecycleState)[0]).toMatchObject({
			connectionId: replacementConnectionId,
			priorMemberStatus: "approved",
			priorEmployeeIsActive: true,
			deactivationOwned: true,
			memberDeactivationOwned: true,
			employeeDeactivationOwned: true,
		});
	});

	it("preserves administrator changes made during old connection deactivation", async () => {
		const target = await deactivateThenReplace("suspend");
		(target.rows(SCIM_MODELS.member)[0] as { status: string }).status =
			"pending";
		(target.rows(SCIM_MODELS.employee)[0] as { isActive: boolean }).isActive =
			true;

		await reconcile(true, target, replacementConnectionId);

		expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
			status: "pending",
		});
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			isActive: true,
		});
		expect(target.rows(SCIM_MODELS.lifecycleState)[0]).toMatchObject({
			connectionId: replacementConnectionId,
			deactivationOwned: false,
			memberDeactivationOwned: false,
			employeeDeactivationOwned: false,
		});
	});

	it.each([
		["suspend", "member", "pending"],
		["suspend", "employee", true],
		["soft_delete", "member", "pending"],
		["soft_delete", "employee", true],
	] as const)(
		"preserves administrator changes for %s %s reactivation",
		async (deprovisionAction, changedField, administratorValue) => {
			const target = fixture({
				deprovisionAction,
				member: {
					id: "member_existing",
					organizationId,
					userId,
					role: "member",
					status: "approved",
				},
				employee: {
					id: "employee_existing",
					organizationId,
					userId,
					role: "employee",
					isActive: true,
				},
			});
			await reconcile(false, target);
			const lifecycle = target.rows(SCIM_MODELS.lifecycleState)[0];
			expect(lifecycle).toMatchObject({
				memberDeactivationOwned: deprovisionAction === "suspend",
				employeeDeactivationOwned: true,
			});

			if (changedField === "member") {
				(target.rows(SCIM_MODELS.member)[0] as { status: string }).status =
					administratorValue as string;
			} else {
				(
					target.rows(SCIM_MODELS.employee)[0] as { isActive: boolean }
				).isActive = administratorValue as boolean;
			}
			await reconcile(true, target);

			expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
				status: changedField === "member" ? "pending" : "approved",
			});
			expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
				isActive: true,
			});
			expect(target.rows(SCIM_MODELS.lifecycleState)[0]).toMatchObject({
				deactivationOwned: false,
				memberDeactivationOwned: false,
				employeeDeactivationOwned: false,
			});
		},
	);

	it("does not reactivate pending inactive state without a prior SCIM deactivation", async () => {
		const target = fixture({
			autoActivate: true,
			member: {
				id: "member_existing",
				organizationId,
				userId,
				status: "pending",
			},
			employee: {
				id: "employee_existing",
				organizationId,
				userId,
				role: "employee",
				isActive: false,
			},
		});
		await reconcile(true, target);

		expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({
			status: "pending",
		});
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			isActive: false,
		});
	});

	it("restores a nullable prior member status after SCIM suspension", async () => {
		const target = fixture({
			member: {
				id: "member_existing",
				organizationId,
				userId,
				role: "member",
				status: null,
			},
			employee: {
				id: "employee_existing",
				organizationId,
				userId,
				role: "employee",
				isActive: true,
			},
		});

		await reconcile(false, target);
		await reconcile(true, target);

		expect(target.rows(SCIM_MODELS.member)[0]).toMatchObject({ status: null });
	});

	it("qualifies every lookup and system audit to the organization with opaque identifiers", async () => {
		const target = await reconcile(true, fixture({ autoActivate: true }));
		const calls = target.operations.findOne.mock.calls.map(([query]) => query);

		expect(
			calls.filter((query) => query.model !== SCIM_MODELS.providerConfig),
		).toSatisfy(
			(queries: Array<{ where: Array<{ field: string; value: unknown }> }>) =>
				queries.every((query) =>
					query.where.some(
						(where) =>
							where.field === "organizationId" &&
							where.value === organizationId,
					),
				),
		);
		expect(target.rows(SCIM_MODELS.lifecycleAudit)[0]).toMatchObject({
			organizationId,
			userId,
			actorType: "system",
			createdBy: null,
		});
		expect(
			JSON.stringify(target.rows(SCIM_MODELS.provisioningAudit)),
		).not.toMatch(/email|displayName|userName/i);
	});

	it("rejects a connection that is not the active organization config", async () => {
		const target = fixture();
		(
			target.rows(SCIM_MODELS.providerConfig)[0] as { connectionId: string }
		).connectionId = "connection_foreign";

		await expect(reconcile(true, target)).rejects.toThrow(
			"SCIM connection is not active",
		);
		expect(target.rows(SCIM_MODELS.member)).toHaveLength(0);
	});

	it("matches the active config connection rather than trusting the first organization source", async () => {
		const target = fixture({ autoActivate: true });
		const input = projected(true);
		input.sources = [
			{
				id: "source_old",
				connectionId: "connection_old",
				provisioningDomainId: organizationId,
				active: false,
			},
			...input.sources,
		];

		await reconcileSCIMLifecycle(input, { database: target.database });

		expect(target.rows(SCIM_MODELS.member)).toHaveLength(1);
	});
});
