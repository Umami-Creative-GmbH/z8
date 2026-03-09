"use server";

import { and, desc, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { travelExpensePolicy } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";

export type TravelExpensePolicyData = typeof travelExpensePolicy.$inferSelect;

export interface UpsertTravelExpensePolicyInput {
	id?: string;
	effectiveFrom: Date;
	effectiveTo?: Date | null;
	currency: string;
	mileageRatePerKm?: number;
	perDiemRatePerDay?: number;
	isActive: boolean;
}

export async function getTravelExpensePolicies(): Promise<
	ServerActionResult<TravelExpensePolicyData[]>
> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const policies = await db.query.travelExpensePolicy.findMany({
			where: eq(travelExpensePolicy.organizationId, authContext.employee.organizationId),
			orderBy: [desc(travelExpensePolicy.effectiveFrom)],
		});

		return { success: true, data: policies as TravelExpensePolicyData[] };
	} catch (error) {
		console.error("Error fetching travel expense policies:", error);
		return { success: false, error: "Failed to fetch travel expense policies" };
	}
}

export async function upsertTravelExpensePolicy(
	input: UpsertTravelExpensePolicyInput,
): Promise<ServerActionResult<{ id: string }>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const organizationId = authContext.employee.organizationId;
		const userId = authContext.user.id;

		if (input.isActive) {
			await db
				.update(travelExpensePolicy)
				.set({
					isActive: false,
					updatedBy: userId,
					updatedAt: new Date(),
				})
				.where(
					input.id
						? and(
								eq(travelExpensePolicy.organizationId, organizationId),
								eq(travelExpensePolicy.isActive, true),
								ne(travelExpensePolicy.id, input.id),
							)
						: and(
								eq(travelExpensePolicy.organizationId, organizationId),
								eq(travelExpensePolicy.isActive, true),
							),
				);
		}

		if (input.id) {
			const [updatedPolicy] = await db
				.update(travelExpensePolicy)
				.set({
					effectiveFrom: input.effectiveFrom,
					effectiveTo: input.effectiveTo ?? null,
					currency: input.currency,
					mileageRatePerKm:
						input.mileageRatePerKm === undefined ? null : String(input.mileageRatePerKm),
					perDiemRatePerDay:
						input.perDiemRatePerDay === undefined ? null : String(input.perDiemRatePerDay),
					isActive: input.isActive,
					updatedBy: userId,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(travelExpensePolicy.id, input.id),
						eq(travelExpensePolicy.organizationId, organizationId),
					),
				)
				.returning({ id: travelExpensePolicy.id });

			if (!updatedPolicy) {
				return { success: false, error: "Travel expense policy not found" };
			}

			revalidatePath("/settings/travel-expenses");
			return { success: true, data: { id: updatedPolicy.id } };
		}

		const [createdPolicy] = await db
			.insert(travelExpensePolicy)
			.values({
				organizationId,
				effectiveFrom: input.effectiveFrom,
				effectiveTo: input.effectiveTo ?? null,
				currency: input.currency,
				mileageRatePerKm:
					input.mileageRatePerKm === undefined ? null : String(input.mileageRatePerKm),
				perDiemRatePerDay:
					input.perDiemRatePerDay === undefined ? null : String(input.perDiemRatePerDay),
				isActive: input.isActive,
				createdBy: userId,
				updatedBy: userId,
				updatedAt: new Date(),
			})
			.returning({ id: travelExpensePolicy.id });

		if (!createdPolicy) {
			return { success: false, error: "Failed to upsert travel expense policy" };
		}

		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { id: createdPolicy.id } };
	} catch (error) {
		console.error("Error upserting travel expense policy:", error);
		return { success: false, error: "Failed to upsert travel expense policy" };
	}
}
