import { trace } from "@opentelemetry/api";
import { Context, Effect, Layer, Schedule } from "effect";
import { sendEmail as sendEmailResend } from "@/lib/email/email-service";
import { createLogger } from "@/lib/logger";
import { EmailError } from "../errors";

const logger = createLogger("EmailService");

export class EmailService extends Context.Tag("EmailService")<
	EmailService,
	{
		readonly send: (params: {
			to: string;
			subject: string;
			html: string;
		}) => Effect.Effect<{ messageId: string }, EmailError>;
	}
>() {}

// Retry policy: exponential backoff with max 3 retries
const retryPolicy = Schedule.exponential("100 millis").pipe(
	Schedule.compose(Schedule.recurs(3)),
	Schedule.jittered,
);

export const EmailServiceLive = Layer.succeed(
	EmailService,
	EmailService.of({
		send: (params) =>
			Effect.gen(function* (_) {
				const tracer = trace.getTracer("email");

				return yield* _(
					Effect.tryPromise({
						try: () =>
							tracer.startActiveSpan(
								"email.send",
								{
									attributes: {
										"email.recipient": params.to,
										"email.subject": params.subject,
									},
								},
								async (span) => {
									try {
										logger.info({ to: params.to }, "Sending email");

										const result = await sendEmailResend(params);

										if (!result.success) {
											throw new Error(result.error || "Unknown email error");
										}

										span.setStatus({ code: 1 });
										span.setAttribute("email.message_id", result.messageId || "");

										return { messageId: result.messageId || "" };
									} catch (error) {
										span.recordException(error as Error);
										span.setStatus({ code: 2, message: String(error) });
										throw error;
									} finally {
										span.end();
									}
								},
							),
						catch: (error) =>
							new EmailError({
								message: "Failed to send email",
								recipient: params.to,
								cause: error,
							}),
					}),
					Effect.retry(retryPolicy),
					Effect.tapError((error) =>
						Effect.sync(() => logger.error({ error, to: params.to }, "Email failed after retries")),
					),
				);
			}),
	}),
);
