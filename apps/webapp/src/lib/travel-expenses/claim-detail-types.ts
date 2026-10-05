import type {
	travelExpenseAttachment,
	travelExpenseClaim,
	travelExpenseDecisionLog,
} from "@/db/schema/travel-expense";

type Claim = typeof travelExpenseClaim.$inferSelect;
type Decision = typeof travelExpenseDecisionLog.$inferSelect;
/** JSON boundary for the persisted claim; calendar dates remain plain date strings. */
export interface TravelExpenseClaimDetailData {
	claim: Omit<
		Claim,
		| "tripStart"
		| "tripEnd"
		| "createdAt"
		| "updatedAt"
		| "submittedAt"
		| "decidedAt"
	> & {
		tripStart: string;
		tripEnd: string;
		createdAt: string;
		updatedAt: string;
		submittedAt: string | null;
		decidedAt: string | null;
	};
	attachments: Pick<
		typeof travelExpenseAttachment.$inferSelect,
		| "id"
		| "fileName"
		| "mimeType"
		| "sizeBytes"
		| "checksumSha256"
		| "storageVersionId"
	>[];
	decisions: (Omit<Decision, "createdAt"> & {
		createdAt: string;
		actorName: string | null;
	})[];
}
