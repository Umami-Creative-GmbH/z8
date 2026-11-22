import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { readDrivingLicenceCheckSubject } from "./check-subject";
import { type DrivingLicenceActor, requireDrivingLicenceActor } from "./context";
import {
	drivingLicenceRoles,
	readDrivingLicenceVisibility,
	showsMyDrivingLicence,
	showsTeamDrivingLicence,
} from "./visibility";

async function actorOrNotFound(): Promise<DrivingLicenceActor> {
	try {
		return await requireDrivingLicenceActor();
	} catch {
		notFound();
	}
}

async function readActorVisibility() {
	const actor = await actorOrNotFound();
	const visibility = await readDrivingLicenceVisibility({
		organizationId: actor.organizationId,
		userId: actor.userId,
	});
	return { actor, visibility };
}

/**
 * `/driving-licence`, My driving licence (#1937): not found while the feature is off, or unless
 * the viewer is an intended driver or still has their own retained check records.
 */
export async function requireMyDrivingLicencePage() {
	const { actor, visibility } = await readActorVisibility();
	if (!showsMyDrivingLicence(visibility) || !actor.employeeId) notFound();
	return { actor, visibility, employeeId: actor.employeeId };
}

/**
 * `/team/driving-licence` (#1937): not found while the feature is off, or unless the viewer is a
 * verifier or holds the planning permission. Administering the settings grants neither.
 */
export async function requireTeamDrivingLicencePage() {
	const { actor, visibility } = await readActorVisibility();
	if (!showsTeamDrivingLicence(visibility)) notFound();
	return { actor, visibility, roles: drivingLicenceRoles(visibility) };
}

/**
 * `/team/driving-licence/[employee]` (#1429, #1937): not found unless the feature is on, the
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
