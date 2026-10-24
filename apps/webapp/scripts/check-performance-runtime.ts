import { env } from "@/env";

const local = (value: string | undefined) =>
	value &&
	["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
if (env.NODE_ENV !== "production" || process.env.SKIP_ENV_VALIDATION !== "0")
	throw new Error("Fixture requires validated production runtime settings");
if (
	!Number.isFinite(Number(env.REDIS_COMMAND_TIMEOUT_MS)) ||
	Number(env.REDIS_COMMAND_TIMEOUT_MS) <= 0
)
	throw new Error("Fixture Redis timeout is invalid");
if (
	!local(env.S3_PUBLIC_ENDPOINT) ||
	env.S3_PRIVATE_ENDPOINT !== env.S3_PUBLIC_ENDPOINT
)
	throw new Error("Fixture storage must remain local");
if (
	env.BILLING_ENABLED !== "false" ||
	env.TELEMETRY_ENABLED !== "false" ||
	env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
	(env.OTEL_EXPORTER_OTLP_ENDPOINT && !local(env.OTEL_EXPORTER_OTLP_ENDPOINT))
)
	throw new Error("External fixture integrations must remain disabled");
if (process.env.CIRCLE_NODE_TOTAL !== "3")
	throw new Error("Fixture build conditions require two Next.js workers");
console.log(
	"Fixture production configuration validated: bounded Redis timeout, local storage and two build workers.",
);
