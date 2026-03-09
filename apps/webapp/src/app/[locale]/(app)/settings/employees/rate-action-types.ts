import { employeeRateHistory } from "@/db/schema";

export type RateHistoryEntry = typeof employeeRateHistory.$inferSelect & {
	creator?: {
		id: string;
		name: string;
		email: string;
	};
};
