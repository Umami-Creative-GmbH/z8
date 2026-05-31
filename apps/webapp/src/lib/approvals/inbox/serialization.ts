import { DateTime } from "luxon";

export function serializeDate(value: Date | string | null | undefined): string | null {
	if (value == null) return null;

	const dateTime =
		typeof value === "string"
			? DateTime.fromISO(value, { zone: "utc" })
			: DateTime.fromJSDate(value, { zone: "utc" });

	if (!dateTime.isValid) {
		throw new Error(`Invalid approval inbox date: ${dateTime.invalidExplanation ?? "unknown reason"}`);
	}

	const iso = dateTime.toUTC().toISO();
	if (!iso) {
		throw new Error("Invalid approval inbox date: could not serialize to ISO string");
	}

	return iso;
}

export function getAgeDays({ createdAt, now }: { createdAt: Date | string; now?: Date }): number {
	const createdAtDateTime =
		typeof createdAt === "string"
			? DateTime.fromISO(createdAt, { zone: "utc" })
			: DateTime.fromJSDate(createdAt, { zone: "utc" });
	const nowDateTime = now ? DateTime.fromJSDate(now, { zone: "utc" }) : DateTime.utc();

	if (!createdAtDateTime.isValid) return 0;

	return Math.max(0, Math.floor(nowDateTime.diff(createdAtDateTime, "days").days));
}

export function assertSerializableApprovalPayload(payload: unknown): void {
	assertJsonSafeApprovalPayload(payload, "$", new WeakSet<object>());
	JSON.parse(JSON.stringify(payload));
}

function assertJsonSafeApprovalPayload(
	value: unknown,
	path: string,
	seen: WeakSet<object>,
): void {
	if (typeof value === "function") {
		throw new Error(`Approval inbox payload contains function at ${path}`);
	}

	if (value instanceof Date) {
		throw new Error(`Approval inbox payload contains Date instance at ${path}; use an ISO string`);
	}

	if (!value || typeof value !== "object") return;

	if (seen.has(value)) return;
	seen.add(value);

	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			const childPath = `${path}[${index}]`;
			if (item === undefined) {
				throw new Error(`Approval inbox payload contains undefined value at ${childPath}`);
			}

			assertJsonSafeApprovalPayload(item, childPath, seen);
		});
		return;
	}

	for (const [key, child] of Object.entries(value)) {
		const childPath = `${path}.${key}`;
		if (child === undefined) {
			throw new Error(`Approval inbox payload contains undefined value at ${childPath}`);
		}

		assertJsonSafeApprovalPayload(child, childPath, seen);
	}
}
