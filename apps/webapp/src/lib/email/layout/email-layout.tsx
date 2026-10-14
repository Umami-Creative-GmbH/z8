// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import { Fragment, type ReactNode } from "react";
import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Link,
	Preview,
	Section,
	Text,
} from "react-email";
import type { EmailTranslate } from "../email-i18n";

/** A labelled value shown in the detail box, both already in the recipient language. */
export interface EmailDetailRow {
	label: string;
	value: string;
}

/** The email's one button. `label` is already translated. */
export interface EmailAction {
	label: string;
	href: string;
}

export interface EmailLayoutProps {
	/** The recipient language; sets `<html lang>`. */
	locale: string;
	/** The `emails` namespace translator in `locale`, for the layout chrome. */
	t: EmailTranslate;
	/** The heading, already translated. */
	title: string;
	/** The inbox preview line; none when left out. */
	preview?: string;
	/** Body content, normally `EmailText` paragraphs. */
	children?: ReactNode;
	/** Optional detail rows, shown after the body. */
	details?: readonly EmailDetailRow[];
	/** Optional button, shown after the details, with a plain-link fallback. */
	action?: EmailAction;
	/** Optional small print above the footer (e.g. "this link expires in 1 hour"). */
	note?: ReactNode;
}

/**
 * The shared, branded React Email layout (ADR 0001, #812). Notification emails
 * (`NotificationEmail`) and the dedicated templates (verification, password reset,
 * invitation, security alert, export ready/failed, organization deletion) and the
 * billing and scheduled-export emails render inside it, so every email has the same
 * chrome, translated through the `emails` namespace.
 */
export function EmailLayout({
	locale,
	t,
	title,
	preview,
	children,
	details,
	action,
	note,
}: EmailLayoutProps) {
	return (
		<Html lang={locale}>
			<Head />
			{preview ? <Preview>{preview}</Preview> : null}
			<Body style={styles.main}>
				<Container style={styles.container}>
					<Text style={styles.brand}>Z8</Text>
					<Heading as="h1" style={styles.heading}>
						{title}
					</Heading>
					{children}
					{details && details.length > 0 ? <EmailDetailRows rows={details} /> : null}
					{action ? (
						<>
							<Section style={styles.buttonSection}>
								<Button href={action.href} style={styles.button}>
									{action.label}
								</Button>
							</Section>
							<Text style={styles.small}>
								{t("emails.layout.actionFallback", "If the button does not work, open this link:")}{" "}
								<Link href={action.href} style={styles.link}>
									{action.href}
								</Link>
							</Text>
						</>
					) : null}
					{note ? <Text style={styles.small}>{note}</Text> : null}
					<Hr style={styles.hr} />
					<Text style={styles.footer}>
						{t("emails.layout.footer", "This email was sent by Z8.")}
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

/** A body paragraph. Plain text keeps its line breaks. */
export function EmailText({ children }: { children: ReactNode }) {
	return (
		<Text style={styles.text}>
			{typeof children === "string" ? withLineBreaks(children) : children}
		</Text>
	);
}

/** The detail box: one label/value pair per row. */
export function EmailDetailRows({ rows }: { rows: readonly EmailDetailRow[] }) {
	return (
		<Section style={styles.details}>
			{rows.map((row) => (
				<div key={row.label}>
					<Text style={styles.detailLabel}>{row.label}</Text>
					<Text style={styles.detailValue}>{row.value}</Text>
				</div>
			))}
		</Section>
	);
}

function withLineBreaks(text: string): ReactNode {
	const lines = text.split("\n");
	return lines.map((line, index) => (
		// Lines of one static string: their order is their identity.
		// biome-ignore lint/suspicious/noArrayIndexKey: static text lines
		<Fragment key={index}>
			{index > 0 ? <br /> : null}
			{line}
		</Fragment>
	));
}

const BRAND_BLUE = "#2563eb";
const TEXT = "#1f2937";
const MUTED = "#6b7280";

const styles = {
	main: {
		backgroundColor: "#f6f9fc",
		fontFamily:
			'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
	},
	container: {
		backgroundColor: "#ffffff",
		margin: "0 auto",
		padding: "24px 0 40px",
		marginBottom: "64px",
		maxWidth: "600px",
	},
	brand: {
		color: BRAND_BLUE,
		fontSize: "20px",
		fontWeight: "700",
		letterSpacing: "0.5px",
		padding: "0 40px",
		margin: "0 0 8px",
	},
	heading: {
		color: TEXT,
		fontSize: "22px",
		fontWeight: "600",
		lineHeight: "30px",
		padding: "0 40px",
		margin: "16px 0",
	},
	text: {
		color: TEXT,
		fontSize: "16px",
		lineHeight: "26px",
		padding: "0 40px",
		margin: "0 0 16px",
	},
	details: {
		backgroundColor: "#f8fafc",
		border: "1px solid #e2e8f0",
		borderRadius: "8px",
		margin: "8px 40px 24px",
		padding: "8px 20px",
		width: "auto",
	},
	detailLabel: {
		color: MUTED,
		fontSize: "12px",
		fontWeight: "600",
		letterSpacing: "0.5px",
		textTransform: "uppercase" as const,
		margin: "12px 0 2px",
	},
	detailValue: {
		color: TEXT,
		fontSize: "15px",
		lineHeight: "22px",
		margin: "0 0 4px",
	},
	buttonSection: {
		padding: "0 40px",
		margin: "24px 0 16px",
	},
	button: {
		backgroundColor: BRAND_BLUE,
		borderRadius: "6px",
		color: "#ffffff",
		display: "inline-block",
		fontSize: "16px",
		fontWeight: "600",
		padding: "12px 28px",
		textDecoration: "none",
	},
	small: {
		color: MUTED,
		fontSize: "13px",
		lineHeight: "20px",
		padding: "0 40px",
		margin: "0 0 12px",
		wordBreak: "break-all" as const,
	},
	link: {
		color: BRAND_BLUE,
		textDecoration: "underline",
	},
	hr: {
		borderColor: "#e6ebf1",
		margin: "24px 40px",
	},
	footer: {
		color: MUTED,
		fontSize: "13px",
		lineHeight: "20px",
		padding: "0 40px",
		margin: "0",
	},
};
