const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MARKER_KEYS = [
	"kind",
	"organizationId",
	"requesterEmployeeId",
	"requesterUserId",
	"workPeriodId",
	"chainInstanceId",
	"cancelledAt",
] as const;

export interface RequesterCancellationMarker {
	kind: "requester";
	organizationId: string;
	requesterEmployeeId: string;
	requesterUserId: string;
	workPeriodId: string;
	chainInstanceId: string | null;
	cancelledAt: string;
}

export function buildRequesterCancellationMarker(input: {
	organizationId: string;
	requesterEmployeeId: string;
	requesterUserId: string;
	workPeriodId: string;
	chainInstanceId: string | null;
	cancelledAt: string;
}): RequesterCancellationMarker {
	return { kind: "requester", ...input };
}

export function parseRequesterCancellationMarker(
	value: unknown,
): RequesterCancellationMarker {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null)
	) {
		throw new Error("Invalid time correction cancellation marker");
	}
	const keys = Reflect.ownKeys(value);
	if (
		keys.length !== MARKER_KEYS.length ||
		keys.some(
			(key) =>
				typeof key !== "string" ||
				!MARKER_KEYS.some((expectedKey) => expectedKey === key),
		)
	) {
		throw new Error("Invalid time correction cancellation marker");
	}
	const marker = Object.fromEntries(
		MARKER_KEYS.map((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				throw new Error("Invalid time correction cancellation marker");
			}
			return [key, descriptor.value];
		}),
	) as Record<(typeof MARKER_KEYS)[number], unknown>;
	if (
		marker.kind !== "requester" ||
		typeof marker.organizationId !== "string" ||
		marker.organizationId.length === 0 ||
		typeof marker.requesterEmployeeId !== "string" ||
		marker.requesterEmployeeId.length === 0 ||
		typeof marker.requesterUserId !== "string" ||
		marker.requesterUserId.length === 0 ||
		typeof marker.workPeriodId !== "string" ||
		marker.workPeriodId.length === 0 ||
		(marker.chainInstanceId !== null &&
			(typeof marker.chainInstanceId !== "string" ||
				!UUID.test(marker.chainInstanceId))) ||
		typeof marker.cancelledAt !== "string"
	) {
		throw new Error("Invalid time correction cancellation marker");
	}
	return marker as RequesterCancellationMarker;
}
