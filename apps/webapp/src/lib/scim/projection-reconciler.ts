import type {
	SCIMProjectedUserState,
	SCIMRoleProjection,
	SCIMTransactionContext,
} from "@better-auth/scim";
import { resolveSCIMReconciliationContext } from "./reconciliation-context";
import {
	createSCIMTransactionStore,
	type SCIMProviderConfigRecord,
	type SCIMRoleTemplateRecord,
} from "./transaction-store";

function templateIsAvailable(
	template: SCIMRoleTemplateRecord | null,
	organizationId: string,
): template is SCIMRoleTemplateRecord {
	return (
		template?.isActive === true &&
		(template.organizationId === organizationId ||
			(template.organizationId === null && template.isGlobal === true))
	);
}

async function requireConfig(
	organizationId: string,
	connectionId: string,
	context: SCIMTransactionContext,
): Promise<SCIMProviderConfigRecord> {
	const config = await createSCIMTransactionStore(
		context.database,
	).getActiveProviderConfig(organizationId, connectionId);
	if (!config) throw new Error("SCIM connection is not active");
	return config;
}

export const scimRoleProjection: SCIMRoleProjection = {
	async map(input, context) {
		if (!input.source.externalId?.trim()) return undefined;
		await requireConfig(
			input.provisioningDomainId,
			input.connectionId,
			context,
		);
		const mapping = await createSCIMTransactionStore(
			context.database,
		).getRoleMapping(input.provisioningDomainId, input.source.externalId);
		return mapping ? [mapping.roleTemplateId] : undefined;
	},
	async exists(input, context) {
		await requireConfig(
			input.provisioningDomainId,
			input.connectionId,
			context,
		);
		const template = await createSCIMTransactionStore(
			context.database,
		).getRoleTemplate(input.role);
		return templateIsAvailable(template, input.provisioningDomainId);
	},
};

export async function reconcileSCIMRoleProjection(
	input: SCIMProjectedUserState,
	context: SCIMTransactionContext,
): Promise<void> {
	const organizationId = input.provisioningDomainId;
	const store = createSCIMTransactionStore(context.database);
	const { config } = await resolveSCIMReconciliationContext(input, store);
	const candidates = [];
	for (const grant of input.grants) {
		const externalId = grant.source.externalId;
		if (!externalId?.trim()) continue;
		const mapping = await store.getRoleMapping(organizationId, externalId);
		if (!mapping || mapping.roleTemplateId !== grant.role) continue;
		const template = await store.getRoleTemplate(mapping.roleTemplateId);
		if (templateIsAvailable(template, organizationId))
			candidates.push({ mapping, template });
	}
	candidates.sort(
		(left, right) =>
			right.mapping.priority - left.mapping.priority ||
			left.mapping.id.localeCompare(right.mapping.id),
	);
	const winner = candidates[0];
	const desiredTemplate =
		winner?.template ??
		(await store.getRoleTemplate(config.defaultRoleTemplateId));
	if (!templateIsAvailable(desiredTemplate, organizationId)) {
		throw new Error("SCIM role template is unavailable");
	}

	const previousProjection = await store.getProjectionState(
		organizationId,
		input.userId,
	);
	const assignment = await store.getRoleAssignment(
		organizationId,
		input.userId,
	);
	await store.putProjectionState({
		organizationId,
		userId: input.userId,
		roleTemplateId: desiredTemplate.id,
		sourceGroupId: winner?.mapping.idpGroupId ?? null,
	});
	if (assignment && assignment.assignmentSource !== "scim") return;
	const employee = await store.getEmployee(organizationId, input.userId);
	if (!employee) throw new Error("SCIM employee is unavailable");
	await store.setEmployeeRole(
		organizationId,
		employee.id,
		desiredTemplate.employeeRole,
	);
	await store.replaceOrgTeamPermissions({
		organizationId,
		employeeId: employee.id,
		permissions: desiredTemplate.teamPermissions ?? {},
	});
	const defaultTeamMembershipOwned = await store.replaceDefaultTeam({
		organizationId,
		employeeId: employee.id,
		previousTeamId: previousProjection?.appliedDefaultTeamId ?? null,
		previousTeamMembershipOwned:
			previousProjection?.appliedDefaultTeamMembershipOwned === true,
		defaultTeamId: desiredTemplate.defaultTeamId,
	});
	await store.putRoleAssignment({
		organizationId,
		userId: input.userId,
		roleTemplateId: desiredTemplate.id,
		idpGroupId: winner?.mapping.idpGroupId ?? null,
	});
	await store.putAppliedProjectionState({
		organizationId,
		userId: input.userId,
		appliedRoleTemplateId: desiredTemplate.id,
		appliedDefaultTeamId: desiredTemplate.defaultTeamId,
		appliedDefaultTeamMembershipOwned: defaultTeamMembershipOwned,
	});
	if (previousProjection?.appliedRoleTemplateId !== desiredTemplate.id) {
		await store.createProvisioningAudit({
			organizationId,
			connectionId: config.connectionId,
			userId: input.userId,
			eventType: "role_template_applied",
			roleTemplateId: desiredTemplate.id,
		});
	}
}
