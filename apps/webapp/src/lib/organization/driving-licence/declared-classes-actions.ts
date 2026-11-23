"use server";
import { revalidatePath } from "next/cache";
import { runDrivingLicenceAction } from "./action-result";
import { requireDrivingLicenceActor } from "./context";
import { saveDeclaredLicenceClasses, withdrawDeclaredLicenceClasses } from "./declared-classes";

const refusals = ["not_enabled", "not_intended_driver"] as const;

function revalidate() {
	revalidatePath("/driving-licence");
	revalidatePath("/team/driving-licence", "layout");
}

/** The intended driver's own licence classes (#2003). Refusals: `not_enabled`, `not_intended_driver`, `invalid`. */
export async function saveDeclaredLicenceClassesAction(input: unknown) {
	return runDrivingLicenceAction(
		async () => {
			const result = await saveDeclaredLicenceClasses(await requireDrivingLicenceActor(), input);
			revalidate();
			return result;
		},
		{ refusals, invalidCode: "invalid" },
	);
}

export async function withdrawDeclaredLicenceClassesAction() {
	return runDrivingLicenceAction(
		async () => {
			const result = await withdrawDeclaredLicenceClasses(await requireDrivingLicenceActor());
			revalidate();
			return result;
		},
		{ refusals, invalidCode: "invalid" },
	);
}
