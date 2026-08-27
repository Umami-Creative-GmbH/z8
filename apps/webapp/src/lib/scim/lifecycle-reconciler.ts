import type {
	SCIMProjectedUserState,
	SCIMTransactionContext,
} from "@better-auth/scim";
import { resolveSCIMReconciliationContext } from "./reconciliation-context";
import {
	createSCIMTransactionStore,
	type SCIMEmployeeRecord,
	type SCIMMemberRecord,
} from "./transaction-store";

function isBillable(
	member: SCIMMemberRecord | null,
	employee: SCIMEmployeeRecord | null,
) {
	return member?.status === "approved" && employee?.isActive === true;
}

export async function reconcileSCIMLifecycle(
	input: SCIMProjectedUserState,
	context: SCIMTransactionContext,
): Promise<void> {
	const organizationId = input.provisioningDomainId;
	const store = createSCIMTransactionStore(context.database);
	const { config, lifecycle } = await resolveSCIMReconciliationContext(
		input,
		store,
	);

	let [member, employee] = await Promise.all([
		store.getMember(organizationId, input.userId),
		store.getEmployee(organizationId, input.userId),
	]);
	const beforeBillable = isBillable(member, employee);
	let priorMemberStatus = member?.status ?? null;
	let priorEmployeeIsActive = employee?.isActive ?? null;
	let event: "created" | "deactivated" | "reactivated" | null = null;

	if (!member || !employee) {
		const creatingMembership = !member;
		if (!member) {
			member = await store.createMember(
				organizationId,
				input.userId,
				config.autoActivateUsers ? "approved" : "pending",
			);
		}
		if (!employee) {
			employee = await store.createEmployee(
				organizationId,
				input.userId,
				creatingMembership && config.autoActivateUsers,
			);
		}
		priorMemberStatus = member.status;
		priorEmployeeIsActive = employee.isActive;
		event = "created";
	}

	const ownsPriorDeactivation = lifecycle?.deactivationOwned === true;
	let memberDeactivationOwned = ownsPriorDeactivation
		? lifecycle.memberDeactivationOwned
		: false;
	let employeeDeactivationOwned = ownsPriorDeactivation
		? lifecycle.employeeDeactivationOwned
		: false;
	if (!input.active && member && employee && !ownsPriorDeactivation) {
		if (
			config.deprovisionAction === "suspend" &&
			member.status !== "suspended"
		) {
			const updatedMember = await store.setMemberStatus(
				organizationId,
				input.userId,
				"suspended",
				member.status,
			);
			memberDeactivationOwned = updatedMember !== null;
			member =
				updatedMember ??
				(await store.getMember(organizationId, input.userId)) ??
				member;
		}
		if (employee.isActive) {
			const updatedEmployee = await store.setEmployeeActive(
				organizationId,
				input.userId,
				false,
				true,
			);
			employeeDeactivationOwned = updatedEmployee !== null;
			employee =
				updatedEmployee ??
				(await store.getEmployee(organizationId, input.userId)) ??
				employee;
		}
		event = "deactivated";
	}

	if (input.active && ownsPriorDeactivation && member && employee) {
		if (
			memberDeactivationOwned &&
			member.status === "suspended" &&
			member.status !== lifecycle.priorMemberStatus
		) {
			const updatedMember = await store.setMemberStatus(
				organizationId,
				input.userId,
				lifecycle.priorMemberStatus,
				"suspended",
			);
			member =
				updatedMember ??
				(await store.getMember(organizationId, input.userId)) ??
				member;
		}
		if (
			employeeDeactivationOwned &&
			employee.isActive === false &&
			lifecycle.priorEmployeeIsActive !== null &&
			employee.isActive !== lifecycle.priorEmployeeIsActive
		) {
			const updatedEmployee = await store.setEmployeeActive(
				organizationId,
				input.userId,
				lifecycle.priorEmployeeIsActive,
				false,
			);
			employee =
				updatedEmployee ??
				(await store.getEmployee(organizationId, input.userId)) ??
				employee;
		}
		memberDeactivationOwned = false;
		employeeDeactivationOwned = false;
		event = "reactivated";
	}

	const afterBillable = isBillable(member, employee);
	const membershipChanged = beforeBillable !== afterBillable;
	const membershipRevision =
		(lifecycle?.membershipRevision ?? 0) + (membershipChanged ? 1 : 0);
	const deactivating = event === "deactivated";
	await store.putLifecycleState(organizationId, input.userId, {
		connectionId: config.connectionId,
		membershipRevision,
		scimActive: input.active,
		priorMemberStatus: deactivating
			? (lifecycle?.priorMemberStatus ?? priorMemberStatus)
			: event === "reactivated"
				? null
				: (lifecycle?.priorMemberStatus ?? null),
		priorEmployeeIsActive: deactivating
			? (lifecycle?.priorEmployeeIsActive ?? priorEmployeeIsActive)
			: event === "reactivated"
				? null
				: (lifecycle?.priorEmployeeIsActive ?? null),
		deactivationOwned:
			deactivating || (ownsPriorDeactivation && event !== "reactivated"),
		memberDeactivationOwned: deactivating
			? memberDeactivationOwned
			: event === "reactivated"
				? false
				: (lifecycle?.memberDeactivationOwned ?? false),
		employeeDeactivationOwned: deactivating
			? employeeDeactivationOwned
			: event === "reactivated"
				? false
				: (lifecycle?.employeeDeactivationOwned ?? false),
	});

	if (membershipChanged) {
		await store.createSeatOutboxIfAbsent({
			organizationId,
			connectionId: config.connectionId,
			userId: input.userId,
			membershipRevision,
		});
	}
	if (!event || !employee) return;
	await store.createLifecycleAudit({
		organizationId,
		userId: input.userId,
		employeeId: employee.id,
		eventType: event === "deactivated" ? "leave" : "join",
	});
	await store.createProvisioningAudit({
		organizationId,
		connectionId: config.connectionId,
		userId: input.userId,
		eventType:
			event === "created"
				? "user_created"
				: event === "deactivated"
					? "user_deactivated"
					: "user_reactivated",
	});
}
