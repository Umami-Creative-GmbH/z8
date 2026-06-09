import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	decimal,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { invitation, organization, user } from "../auth-schema";
import { contractTypeEnum, genderEnum, roleEnum } from "./enums";
import { team } from "./organization";

export const employeeInvitationDraft = pgTable(
	"employee_invitation_draft",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		invitationId: text("invitation_id")
			.notNull()
			.references(() => invitation.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "set null" }),
		role: roleEnum("role").default("employee").notNull(),
		firstName: text("first_name"),
		lastName: text("last_name"),
		position: text("position"),
		employeeNumber: text("employee_number"),
		gender: genderEnum("gender"),
		pronouns: text("pronouns"),
		birthday: timestamp("birthday", { mode: "date" }),
		startDate: timestamp("start_date"),
		endDate: timestamp("end_date"),
		contractType: contractTypeEnum("contract_type").default("fixed").notNull(),
		currentHourlyRate: decimal("current_hourly_rate", { precision: 10, scale: 2 }),
		updatedBy: text("updated_by").references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.invitationId, table.organizationId],
			foreignColumns: [invitation.id, invitation.organizationId],
			name: "employee_invitation_draft_invitation_org_fk",
		}).onDelete("cascade"),
		uniqueIndex("employeeInvitationDraft_invitationId_unique_idx").on(table.invitationId),
		index("employeeInvitationDraft_organizationId_idx").on(table.organizationId),
		// The team/org composite FK is migration-only so team deletion can null only team_id.
		index("employeeInvitationDraft_teamId_idx").on(table.teamId),
	],
);
