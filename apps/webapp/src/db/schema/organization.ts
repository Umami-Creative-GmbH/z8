import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { genderEnum, roleEnum } from "./enums";

// ============================================
// ORGANIZATION STRUCTURE
// ============================================

// Teams/departments within organizations
export const team = pgTable(
	"team",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("team_organizationId_idx").on(table.organizationId)],
);

// ============================================
// LOCATIONS
// ============================================

// Physical locations within an organization
export const location = pgTable(
	"location",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Basic info
		name: text("name").notNull(),

		// Address fields
		street: text("street"),
		city: text("city"),
		postalCode: text("postal_code"),
		country: text("country"), // ISO 3166-1 alpha-2 code

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("location_organizationId_idx").on(table.organizationId),
		index("location_isActive_idx").on(table.isActive),
		uniqueIndex("location_org_name_idx").on(table.organizationId, table.name),
	],
);

// Subareas within locations (cashier, storage, bistro, etc.)
export const locationSubarea = pgTable(
	"location_subarea",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		locationId: uuid("location_id")
			.notNull()
			.references(() => location.id, { onDelete: "cascade" }),

		name: text("name").notNull(),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("locationSubarea_locationId_idx").on(table.locationId),
		index("locationSubarea_isActive_idx").on(table.isActive),
		uniqueIndex("locationSubarea_location_name_idx").on(table.locationId, table.name),
	],
);

// Employee profile - extends Better Auth user with business-specific fields
// Better Auth member table handles organization membership and roles
export const employee = pgTable(
	"employee",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "set null" }),
		managerId: uuid("manager_id"), // DEPRECATED: Use employee_managers table instead

		// Personal information
		firstName: text("first_name"),
		lastName: text("last_name"),
		gender: genderEnum("gender"),
		birthday: timestamp("birthday", { mode: "date" }),

		// Job information
		role: roleEnum("role").default("employee").notNull(),
		employeeNumber: text("employee_number"),
		position: text("position"),
		startDate: timestamp("start_date"),
		endDate: timestamp("end_date"),
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("employee_userId_idx").on(table.userId),
		index("employee_organizationId_idx").on(table.organizationId),
		index("employee_teamId_idx").on(table.teamId),
		index("employee_managerId_idx").on(table.managerId),
		index("employee_userId_isActive_idx").on(table.userId, table.isActive),
	],
);

// ============================================
// EMPLOYEE MANAGERS (Many-to-Many)
// ============================================

// Junction table for multiple managers per employee
export const employeeManagers = pgTable(
	"employee_managers",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		managerId: uuid("manager_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		isPrimary: boolean("is_primary").default(false).notNull(), // Exactly one primary per employee
		assignedBy: text("assigned_by")
			.notNull()
			.references(() => user.id),
		assignedAt: timestamp("assigned_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("employeeManagers_employeeId_idx").on(table.employeeId),
		index("employeeManagers_managerId_idx").on(table.managerId),
		// Prevent duplicate manager assignments
		index("employeeManagers_unique_idx").on(table.employeeId, table.managerId),
		index("employeeManagers_managerId_isPrimary_idx").on(table.managerId, table.isPrimary),
	],
);

// ============================================
// LOCATION EMPLOYEE ASSIGNMENTS
// ============================================

// Junction table for employees assigned to locations (supervisors)
export const locationEmployee = pgTable(
	"location_employee",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		locationId: uuid("location_id")
			.notNull()
			.references(() => location.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		isPrimary: boolean("is_primary").default(false).notNull(), // Primary supervisor
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("locationEmployee_locationId_idx").on(table.locationId),
		index("locationEmployee_employeeId_idx").on(table.employeeId),
		uniqueIndex("locationEmployee_unique_idx").on(table.locationId, table.employeeId),
	],
);

// Junction table for employees assigned to subareas (supervisors)
export const subareaEmployee = pgTable(
	"subarea_employee",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		subareaId: uuid("subarea_id")
			.notNull()
			.references(() => locationSubarea.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		isPrimary: boolean("is_primary").default(false).notNull(), // Primary supervisor
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("subareaEmployee_subareaId_idx").on(table.subareaId),
		index("subareaEmployee_employeeId_idx").on(table.employeeId),
		uniqueIndex("subareaEmployee_unique_idx").on(table.subareaId, table.employeeId),
	],
);

// ============================================
// TEAM PERMISSIONS (Granular Authorization)
// ============================================

// Granular permissions for team operations
export const teamPermissions = pgTable(
	"team_permissions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }), // null = org-wide

		// Four permission flags
		canCreateTeams: boolean("can_create_teams").default(false).notNull(),
		canManageTeamMembers: boolean("can_manage_team_members").default(false).notNull(),
		canManageTeamSettings: boolean("can_manage_team_settings").default(false).notNull(),
		canApproveTeamRequests: boolean("can_approve_team_requests").default(false).notNull(),

		grantedBy: uuid("granted_by")
			.notNull()
			.references(() => employee.id),
		grantedAt: timestamp("granted_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("teamPermissions_employeeId_idx").on(table.employeeId),
		index("teamPermissions_organizationId_idx").on(table.organizationId),
		index("teamPermissions_teamId_idx").on(table.teamId),
		// One permission record per employee per organization
		index("teamPermissions_unique_idx").on(table.employeeId, table.organizationId),
	],
);
