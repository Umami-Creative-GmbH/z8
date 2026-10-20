import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { readDrivingLicenceCheckSubject } from "./check-subject";
import { type DrivingLicenceActor, requireDrivingLicenceActor } from "./context";
import {
	drivingLicenceRoles,
	readDrivingLicenceVisibility,
	showsDrivingLicenceNavigation,
} from "./visibility";

async function actorOrNotFound(): Promise<DrivingLicenceActor> {
	try {
		return await requireDrivingLicenceActor();
	} catch {
		notFound();
	}
}

/** `/driving-licence`: not found while the feature is off or the viewer holds no role. */
export async function requireDrivingLicencePage() {
	const actor = await actorOrNotFound();
	const visibility = await readDrivingLicenceVisibility({
		organizationId: actor.organizationId,
		userId: actor.userId,
	});
	if (!showsDrivingLicenceNavigation(visibility)) notFound();
	return { actor, visibility, roles: drivingLicenceRoles(visibility) };
}

/**
 * `/driving-licence/checks/[employee]` (#1429): not found unless the feature is on, the
 * viewer currently holds a verifier grant covering that employee, and it is not the
 * viewer's own check.
 */
export async function requireDrivingLicenceCheckPage(employeeId: string) {
	const actor = await actorOrNotFound();
	if (!z.uuid().safeParse(employeeId).success || employeeId === actor.employeeId) notFound();
	const visibility = await readDrivingLicenceVisibility({
		organizationId: actor.organizationId,
		userId: actor.userId,
	});
	if (!drivingLicenceRoles(visibility).checks) notFound();
	const subject = await readDrivingLicenceCheckSubject({
		organizationId: actor.organizationId,
		userId: actor.userId,
		employeeId,
	});
	if (!subject) notFound();
	return { actor, subject };
}

/**
 * `/settings/driving-licence`, after the org admin settings guard: not found unless the
 * reader offers the settings; `retention_only` while the feature is off.
 */
export async function requireDrivingLicenceSettingsPage() {
	const actor = await actorOrNotFound();
	const { settings } = await readDrivingLicenceVisibility({
		organizationId: actor.organizationId,
		userId: actor.userId,
	});
	if (settings === "hidden") notFound();
	return { actor, settings };
}
