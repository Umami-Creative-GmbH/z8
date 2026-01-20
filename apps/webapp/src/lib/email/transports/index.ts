/**
 * Email Transports
 *
 * Barrel export for all email transport implementations.
 */

// Types and interfaces
export type {
	ConsoleTransportConfig,
	EmailMessage,
	EmailTransport,
	EmailTransportResult,
	ResendTransportConfig,
	SmtpTransportConfig,
	TransportConfig,
} from "./base";

// Transport implementations
export { ConsoleTransport } from "./console-transport";
export { createSystemResendTransport, ResendTransport } from "./resend-transport";
export { SmtpTransport } from "./smtp-transport";
