import type { SCIMIdentityResolutionContext } from "@better-auth/scim";
import type { DBTransactionAdapter } from "better-auth";

export const SCIM_MODELS = {
	user: "user",
	member: "member",
	employee: "employee",
	providerConfig: "scimProviderConfig",
	lifecycleState: "scimUserLifecycleState",
	projectionState: "scimRoleProjectionState",
	seatOutbox: "scimSeatSyncOutbox",
	provisioningAudit: "scimProvisioningLog",
	lifecycleAudit: "userLifecycleEvent",
	roleMapping: "roleTemplateMapping",
	roleTemplate: "roleTemplate",
	roleAssignment: "userRoleTemplateAssignment",
	teamPermission: "teamPermissions",
	teamMembership: "teamMembership",
} as const;

export interface SCIMReadUser {
	id: string;
	emailVerified: boolean;
}

export interface SCIMReadMember {
	id: string;
}

export interface SCIMReadStore {
	findUserByEmail(email: string): Promise<SCIMReadUser | null>;
	findOrganizationMember(
		userId: string,
		organizationId: string,
	): Promise<SCIMReadMember | null>;
}

export interface SCIMProviderConfigRecord {
	id: string;
	organizationId: string;
	connectionId: string;
	state: "active";
	autoActivateUsers: boolean;
	deprovisionAction: "soft_delete" | "suspend";
	defaultRoleTemplateId: string;
}

export interface SCIMMemberRecord {
	id: string;
	organizationId: string;
	userId: string;
	role: string;
	status: string | null;
}

export interface SCIMEmployeeRecord {
	id: string;
	organizationId: string;
	userId: string;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
}

export interface SCIMLifecycleStateRecord {
	id: string;
	organizationId: string;
	connectionId: string;
	userId: string;
	membershipRevision: number;
	scimActive: boolean;
	priorMemberStatus: string | null;
	priorEmployeeIsActive: boolean | null;
	deactivationOwned: boolean;
}

export interface SCIMRoleMappingRecord {
	id: string;
	organizationId: string;
	idpType: "scim";
	idpGroupId: string;
	roleTemplateId: string;
	priority: number;
}

export interface SCIMRoleTemplateRecord {
	id: string;
	organizationId: string | null;
	isGlobal: boolean;
	isActive: boolean;
	employeeRole: "admin" | "manager" | "employee";
	defaultTeamId: string | null;
	teamPermissions: {
		canCreateTeams?: boolean;
		canManageTeamMembers?: boolean;
		canManageTeamSettings?: boolean;
		canApproveTeamRequests?: boolean;
	} | null;
}

export interface SCIMRoleAssignmentRecord {
	id: string;
	organizationId: string;
	userId: string;
	roleTemplateId: string;
	assignmentSource: "manual" | "scim" | "sso" | "invite_code";
	idpGroupId: string | null;
}

export interface SCIMProjectionStateRecord {
	id: string;
	organizationId: string;
	userId: string;
	roleTemplateId: string;
	sourceGroupId: string | null;
}

export interface SCIMTransactionStore {
	getActiveProviderConfig(
		organizationId: string,
		connectionId?: string,
	): Promise<SCIMProviderConfigRecord | null>;
	getMember(
		organizationId: string,
		userId: string,
	): Promise<SCIMMemberRecord | null>;
	createMember(
		organizationId: string,
		userId: string,
		status: string,
	): Promise<SCIMMemberRecord>;
	setMemberStatus(
		organizationId: string,
		userId: string,
		status: string | null,
	): Promise<SCIMMemberRecord | null>;
	getEmployee(
		organizationId: string,
		userId: string,
	): Promise<SCIMEmployeeRecord | null>;
	createEmployee(
		organizationId: string,
		userId: string,
		isActive: boolean,
	): Promise<SCIMEmployeeRecord>;
	setEmployeeActive(
		organizationId: string,
		userId: string,
		isActive: boolean,
	): Promise<SCIMEmployeeRecord | null>;
	setEmployeeRole(
		organizationId: string,
		employeeId: string,
		role: SCIMEmployeeRecord["role"],
	): Promise<SCIMEmployeeRecord | null>;
	getLifecycleState(
		organizationId: string,
		userId: string,
	): Promise<SCIMLifecycleStateRecord | null>;
	putLifecycleState(
		organizationId: string,
		userId: string,
		state: Omit<SCIMLifecycleStateRecord, "id" | "organizationId" | "userId">,
	): Promise<void>;
	createSeatOutboxIfAbsent(input: {
		organizationId: string;
		connectionId: string;
		userId: string;
		membershipRevision: number;
	}): Promise<void>;
	createLifecycleAudit(input: {
		organizationId: string;
		userId: string;
		employeeId: string | null;
		eventType: "join" | "leave";
	}): Promise<void>;
	createProvisioningAudit(input: {
		organizationId: string;
		connectionId: string;
		userId: string;
		eventType:
			| "user_created"
			| "user_deactivated"
			| "user_reactivated"
			| "role_template_applied";
		roleTemplateId?: string;
	}): Promise<void>;
	getRoleMapping(
		organizationId: string,
		idpGroupId: string,
	): Promise<SCIMRoleMappingRecord | null>;
	getRoleTemplate(
		roleTemplateId: string,
	): Promise<SCIMRoleTemplateRecord | null>;
	getRoleAssignment(
		organizationId: string,
		userId: string,
	): Promise<SCIMRoleAssignmentRecord | null>;
	putRoleAssignment(input: {
		organizationId: string;
		userId: string;
		roleTemplateId: string;
		idpGroupId: string | null;
	}): Promise<void>;
	getProjectionState(
		organizationId: string,
		userId: string,
	): Promise<SCIMProjectionStateRecord | null>;
	putProjectionState(input: {
		organizationId: string;
		userId: string;
		roleTemplateId: string;
		sourceGroupId: string | null;
	}): Promise<void>;
	replaceOrgTeamPermissions(input: {
		organizationId: string;
		employeeId: string;
		permissions: NonNullable<SCIMRoleTemplateRecord["teamPermissions"]>;
	}): Promise<void>;
	replaceDefaultTeam(input: {
		organizationId: string;
		employeeId: string;
		previousTeamId: string | null;
		defaultTeamId: string | null;
	}): Promise<void>;
}

type SCIMReadDatabase = SCIMIdentityResolutionContext["database"];

export function createSCIMReadStore(database: SCIMReadDatabase): SCIMReadStore {
	return {
		findUserByEmail: (email) =>
			database.findOne<SCIMReadUser>({
				model: SCIM_MODELS.user,
				select: ["id", "emailVerified"],
				where: [{ field: "email", value: email, mode: "insensitive" }],
			}),
		findOrganizationMember: (userId, organizationId) =>
			database.findOne<SCIMReadMember>({
				model: SCIM_MODELS.member,
				select: ["id"],
				where: [
					{ field: "userId", value: userId },
					{ field: "organizationId", value: organizationId },
				],
			}),
	};
}

const organizationUserWhere = (organizationId: string, userId: string) => [
	{ field: "organizationId", value: organizationId },
	{ field: "userId", value: userId },
];

function createUUIDRecord<R>(
	database: DBTransactionAdapter,
	model: string,
	data: Record<string, unknown>,
): Promise<R> {
	return database.create<Record<string, unknown>, R>({
		model,
		data: { id: crypto.randomUUID(), ...data },
		forceAllowId: true,
	});
}

export function createSCIMTransactionStore(
	database: DBTransactionAdapter,
): SCIMTransactionStore {
	return {
		getActiveProviderConfig: (organizationId, connectionId) =>
			database.findOne<SCIMProviderConfigRecord>({
				model: SCIM_MODELS.providerConfig,
				where: [
					{ field: "organizationId", value: organizationId },
					...(connectionId === undefined
						? []
						: [{ field: "connectionId", value: connectionId }]),
					{ field: "state", value: "active" },
				],
			}),
		getMember: (organizationId, userId) =>
			database.findOne({
				model: SCIM_MODELS.member,
				where: organizationUserWhere(organizationId, userId),
			}),
		createMember: (organizationId, userId, status) =>
			database.create({
				model: SCIM_MODELS.member,
				data: {
					organizationId,
					userId,
					role: "member",
					status,
					createdAt: new Date(),
				},
			}),
		setMemberStatus: (organizationId, userId, status) =>
			database.update({
				model: SCIM_MODELS.member,
				where: organizationUserWhere(organizationId, userId),
				update: { status },
			}),
		getEmployee: (organizationId, userId) =>
			database.findOne({
				model: SCIM_MODELS.employee,
				where: organizationUserWhere(organizationId, userId),
			}),
		createEmployee: (organizationId, userId, isActive) =>
			createUUIDRecord(database, SCIM_MODELS.employee, {
				organizationId,
				userId,
				role: "employee",
				isActive,
			}),
		setEmployeeActive: (organizationId, userId, isActive) =>
			database.update({
				model: SCIM_MODELS.employee,
				where: organizationUserWhere(organizationId, userId),
				update: { isActive },
			}),
		setEmployeeRole: (organizationId, employeeId, role) =>
			database.update({
				model: SCIM_MODELS.employee,
				where: [
					{ field: "organizationId", value: organizationId },
					{ field: "id", value: employeeId },
				],
				update: { role },
			}),
		getLifecycleState: (organizationId, userId) =>
			database.findOne({
				model: SCIM_MODELS.lifecycleState,
				where: organizationUserWhere(organizationId, userId),
			}),
		putLifecycleState: async (organizationId, userId, state) => {
			const where = organizationUserWhere(organizationId, userId);
			const current = await database.findOne<SCIMLifecycleStateRecord>({
				model: SCIM_MODELS.lifecycleState,
				where,
			});
			if (current) {
				await database.update({
					model: SCIM_MODELS.lifecycleState,
					where,
					update: state,
				});
				return;
			}
			await createUUIDRecord(database, SCIM_MODELS.lifecycleState, {
				organizationId,
				userId,
				...state,
			});
		},
		createSeatOutboxIfAbsent: async ({
			organizationId,
			connectionId,
			userId,
			membershipRevision,
		}) => {
			const dedupeKey = `scim-seat:${organizationId}:${userId}:${membershipRevision}`;
			const where = [
				{ field: "organizationId", value: organizationId },
				{ field: "dedupeKey", value: dedupeKey },
			];
			if (await database.findOne({ model: SCIM_MODELS.seatOutbox, where }))
				return;
			await createUUIDRecord(database, SCIM_MODELS.seatOutbox, {
				organizationId,
				connectionId,
				userId,
				membershipRevision,
				dedupeKey,
				status: "pending",
			});
		},
		createLifecycleAudit: async ({
			organizationId,
			userId,
			employeeId,
			eventType,
		}) => {
			await createUUIDRecord(database, SCIM_MODELS.lifecycleAudit, {
				organizationId,
				userId,
				employeeId,
				eventType,
				source: "scim",
				actorType: "system",
				createdBy: null,
				metadata: {},
				requiresApproval: false,
				approvalStatus: "approved",
			});
		},
		createProvisioningAudit: async ({
			organizationId,
			connectionId,
			userId,
			eventType,
			roleTemplateId,
		}) => {
			await createUUIDRecord(database, SCIM_MODELS.provisioningAudit, {
				organizationId,
				connectionId,
				userId,
				eventType,
				metadata: roleTemplateId ? { roleTemplateId } : {},
			});
		},
		getRoleMapping: (organizationId, idpGroupId) =>
			database.findOne({
				model: SCIM_MODELS.roleMapping,
				where: [
					{ field: "organizationId", value: organizationId },
					{ field: "idpType", value: "scim" },
					{ field: "idpGroupId", value: idpGroupId },
				],
			}),
		getRoleTemplate: (roleTemplateId) =>
			database.findOne({
				model: SCIM_MODELS.roleTemplate,
				where: [{ field: "id", value: roleTemplateId }],
			}),
		getRoleAssignment: (organizationId, userId) =>
			database.findOne({
				model: SCIM_MODELS.roleAssignment,
				where: organizationUserWhere(organizationId, userId),
			}),
		putRoleAssignment: async ({
			organizationId,
			userId,
			roleTemplateId,
			idpGroupId,
		}) => {
			const where = organizationUserWhere(organizationId, userId);
			const data = {
				roleTemplateId,
				assignmentSource: "scim",
				idpGroupId,
				assignedBy: null,
				assignedAt: new Date(),
			};
			if (
				await database.findOne({ model: SCIM_MODELS.roleAssignment, where })
			) {
				await database.update({
					model: SCIM_MODELS.roleAssignment,
					where,
					update: data,
				});
				return;
			}
			await createUUIDRecord(database, SCIM_MODELS.roleAssignment, {
				organizationId,
				userId,
				...data,
			});
		},
		getProjectionState: (organizationId, userId) =>
			database.findOne({
				model: SCIM_MODELS.projectionState,
				where: organizationUserWhere(organizationId, userId),
			}),
		putProjectionState: async ({
			organizationId,
			userId,
			roleTemplateId,
			sourceGroupId,
		}) => {
			const where = organizationUserWhere(organizationId, userId);
			const data = { roleTemplateId, sourceGroupId };
			if (
				await database.findOne({ model: SCIM_MODELS.projectionState, where })
			) {
				await database.update({
					model: SCIM_MODELS.projectionState,
					where,
					update: data,
				});
				return;
			}
			await createUUIDRecord(database, SCIM_MODELS.projectionState, {
				organizationId,
				userId,
				...data,
			});
		},
		replaceOrgTeamPermissions: async ({
			organizationId,
			employeeId,
			permissions,
		}) => {
			const where = [
				{ field: "organizationId", value: organizationId },
				{ field: "employeeId", value: employeeId },
				{ field: "teamId", value: null },
			];
			const data = {
				canCreateTeams: permissions.canCreateTeams ?? false,
				canManageTeamMembers: permissions.canManageTeamMembers ?? false,
				canManageTeamSettings: permissions.canManageTeamSettings ?? false,
				canApproveTeamRequests: permissions.canApproveTeamRequests ?? false,
			};
			if (
				await database.findOne({ model: SCIM_MODELS.teamPermission, where })
			) {
				await database.update({
					model: SCIM_MODELS.teamPermission,
					where,
					update: data,
				});
				return;
			}
			await createUUIDRecord(database, SCIM_MODELS.teamPermission, {
				organizationId,
				employeeId,
				teamId: null,
				grantedBy: employeeId,
				...data,
			});
		},
		replaceDefaultTeam: async ({
			organizationId,
			employeeId,
			previousTeamId,
			defaultTeamId,
		}) => {
			if (previousTeamId && previousTeamId !== defaultTeamId) {
				await database.delete({
					model: SCIM_MODELS.teamMembership,
					where: [
						{ field: "organizationId", value: organizationId },
						{ field: "employeeId", value: employeeId },
						{ field: "teamId", value: previousTeamId },
					],
				});
			}
			if (!defaultTeamId) return;
			const where = [
				{ field: "organizationId", value: organizationId },
				{ field: "employeeId", value: employeeId },
				{ field: "teamId", value: defaultTeamId },
			];
			if (await database.findOne({ model: SCIM_MODELS.teamMembership, where }))
				return;
			await createUUIDRecord(database, SCIM_MODELS.teamMembership, {
				organizationId,
				employeeId,
				teamId: defaultTeamId,
				createdBy: null,
			});
		},
	};
}
