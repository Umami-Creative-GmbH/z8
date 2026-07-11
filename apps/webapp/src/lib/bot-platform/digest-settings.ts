import { DateTime } from "luxon";

export interface DigestSettings {
	time: string;
	timezone: string;
}

const DIGEST_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function parseDigestSettings(input: DigestSettings): DigestSettings {
	if (!DIGEST_TIME.test(input.time)) {
		throw new Error("Invalid digest time");
	}

	if (!DateTime.fromMillis(0, { zone: input.timezone }).isValid) {
		throw new Error("Invalid digest timezone");
	}

	return input;
}
