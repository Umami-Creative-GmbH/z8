import { env } from "@/env";

export const RETRY_DELAYS_MS =
	env.WEBHOOK_RETRY_DELAYS_MS.split(",").map(Number);
export const MAX_ATTEMPTS = Number(env.WEBHOOK_MAX_ATTEMPTS);
export const WEBHOOK_TIMEOUT_MS = Number(env.WEBHOOK_TIMEOUT_MS);
export const MAX_RESPONSE_BODY_LENGTH = Number(
	env.WEBHOOK_MAX_RESPONSE_BODY_LENGTH,
);
