/**
 * Email Transport Base Interface
 *
 * Defines the contract for all email transport implementations.
 */

/**
 * Email message structure
 */
export interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	from?: string;
	fromName?: string;
	replyTo?: string;
}

/**
 * Result from sending an email
 */
export interface EmailTransportResult {
	success: boolean;
	messageId?: string;
	error?: string;
}

/**
 * Email transport interface
 *
 * All transport implementations must implement this interface.
 */
export interface EmailTransport {
	/**
	 * Send an email message
	 */
	send(message: EmailMessage): Promise<EmailTransportResult>;

	/**
	 * Send a test email to verify the transport configuration
	 */
	test(toEmail: string): Promise<EmailTransportResult>;

	/**
	 * Get the transport name for logging/identification
	 */
	getName(): string;
}

/**
 * Transport configuration for creating transport instances
 */
export interface ResendTransportConfig {
	type: "resend";
	apiKey: string;
	fromEmail: string;
	fromName?: string;
}

export interface SmtpTransportConfig {
	type: "smtp";
	host: string;
	port: number;
	secure: boolean;
	requireTls: boolean;
	auth: {
		user: string;
		pass: string;
	};
	fromEmail: string;
	fromName?: string;
}

export interface ConsoleTransportConfig {
	type: "console";
	fromEmail?: string;
	fromName?: string;
}

export type TransportConfig = ResendTransportConfig | SmtpTransportConfig | ConsoleTransportConfig;
