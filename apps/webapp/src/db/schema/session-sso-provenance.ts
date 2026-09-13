import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, session, user } from "../auth-schema";

/** Application-owned security state. Never accepted as a Better Auth additional input field. */
export const sessionSsoProvenance = pgTable(
	"session_sso_provenance",
	{
		sessionId: text("session_id")
			.primaryKey()
			.references(() => session.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		providerId: text("provider_id").notNull(),
		verifiedAt: timestamp("verified_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("session_sso_provenance_organization_id_idx").on(
			table.organizationId,
		),
	],
);
