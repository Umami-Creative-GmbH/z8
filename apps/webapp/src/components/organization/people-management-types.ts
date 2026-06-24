import type * as authSchema from "@/db/auth-schema";
import type { employee } from "@/db/schema";

export interface MemberWithUserAndEmployee {
	member: typeof authSchema.member.$inferSelect;
	user: typeof authSchema.user.$inferSelect;
	employee: typeof employee.$inferSelect | null;
	teamMemberships?: Array<{ teamId: string }>;
}

export type InvitationWithInviter = typeof authSchema.invitation.$inferSelect & {
	user: typeof authSchema.user.$inferSelect;
	targetTeam?: { id: string; name: string } | null;
};
