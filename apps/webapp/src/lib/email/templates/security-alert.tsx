import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Link,
	Section,
	Text,
} from "@react-email/components";

type SecurityEventType = "password_changed" | "two_factor_enabled" | "two_factor_disabled";

interface SecurityAlertProps {
	userName: string;
	eventType: SecurityEventType;
	timestamp: string;
	ipAddress?: string;
	userAgent?: string;
	securitySettingsUrl: string;
	appUrl: string;
}

const EVENT_CONFIG: Record<
	SecurityEventType,
	{
		title: string;
		description: string;
		icon: string;
		color: string;
		bgColor: string;
		borderColor: string;
	}
> = {
	password_changed: {
		title: "Password Changed",
		description: "Your account password has been successfully changed.",
		icon: "🔐",
		color: "#16a34a",
		bgColor: "#f0fdf4",
		borderColor: "#86efac",
	},
	two_factor_enabled: {
		title: "Two-Factor Authentication Enabled",
		description: "Two-factor authentication has been enabled on your account.",
		icon: "🛡️",
		color: "#16a34a",
		bgColor: "#f0fdf4",
		borderColor: "#86efac",
	},
	two_factor_disabled: {
		title: "Two-Factor Authentication Disabled",
		description: "Two-factor authentication has been disabled on your account.",
		icon: "⚠️",
		color: "#f59e0b",
		bgColor: "#fef3c7",
		borderColor: "#fcd34d",
	},
};

export function SecurityAlert({
	userName,
	eventType,
	timestamp,
	ipAddress,
	userAgent,
	securitySettingsUrl,
	appUrl,
}: SecurityAlertProps) {
	const config = EVENT_CONFIG[eventType];

	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>
						{config.icon} {config.title}
					</Heading>
					<Text style={text}>Hi {userName},</Text>
					<Text style={text}>{config.description}</Text>

					<Section
						style={{
							...detailsBox,
							backgroundColor: config.bgColor,
							border: `1px solid ${config.borderColor}`,
						}}
					>
						<Text style={detailLabel}>Event</Text>
						<Text style={{ ...statusText, color: config.color }}>{config.title}</Text>

						<Text style={detailLabel}>Time</Text>
						<Text style={detailValue}>{timestamp}</Text>

						{ipAddress && (
							<>
								<Text style={detailLabel}>IP Address</Text>
								<Text style={detailValue}>{ipAddress}</Text>
							</>
						)}

						{userAgent && (
							<>
								<Text style={detailLabel}>Device</Text>
								<Text style={deviceText}>{userAgent}</Text>
							</>
						)}
					</Section>

					<Text style={text}>
						If you did not make this change, please secure your account immediately by changing your
						password and reviewing your security settings.
					</Text>

					<Section style={{ textAlign: "center" as const, margin: "32px 0" }}>
						<Button href={securitySettingsUrl} style={button}>
							Review Security Settings
						</Button>
					</Section>

					<Hr style={hr} />

					<Text style={warningText}>
						If you didn't recognize this activity, please{" "}
						<Link href={`${appUrl}/settings/security`} style={warningLink}>
							change your password
						</Link>{" "}
						immediately and contact support.
					</Text>

					<Text style={footer}>
						<Link href={appUrl} style={link}>
							Go to Dashboard
						</Link>
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default SecurityAlert;

// Styles
const main = {
	backgroundColor: "#f6f9fc",
	fontFamily:
		'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
	backgroundColor: "#ffffff",
	margin: "0 auto",
	padding: "20px 0 48px",
	marginBottom: "64px",
	maxWidth: "600px",
};

const h1 = {
	color: "#333",
	fontSize: "24px",
	fontWeight: "bold",
	padding: "0 40px",
	margin: "30px 0",
	textAlign: "center" as const,
};

const text = {
	color: "#333",
	fontSize: "16px",
	lineHeight: "26px",
	padding: "0 40px",
};

const detailsBox = {
	borderRadius: "8px",
	margin: "24px 40px",
	padding: "24px",
};

const detailLabel = {
	color: "#666",
	fontSize: "12px",
	fontWeight: "600",
	textTransform: "uppercase" as const,
	letterSpacing: "0.5px",
	margin: "16px 0 4px 0",
};

const detailValue = {
	color: "#333",
	fontSize: "16px",
	margin: "0 0 8px 0",
};

const statusText = {
	...detailValue,
	fontWeight: "600",
};

const deviceText = {
	...detailValue,
	fontSize: "14px",
	color: "#666",
	wordBreak: "break-word" as const,
};

const button = {
	backgroundColor: "#5469d4",
	borderRadius: "6px",
	color: "#fff",
	fontSize: "16px",
	fontWeight: "600",
	textDecoration: "none",
	textAlign: "center" as const,
	display: "inline-block",
	padding: "12px 32px",
};

const hr = {
	borderColor: "#e6ebf1",
	margin: "20px 40px",
};

const warningText = {
	color: "#666",
	fontSize: "14px",
	lineHeight: "24px",
	padding: "0 40px",
	textAlign: "center" as const,
};

const warningLink = {
	color: "#dc2626",
	fontWeight: "600",
};

const footer = {
	color: "#8898aa",
	fontSize: "14px",
	lineHeight: "24px",
	padding: "0 40px",
	textAlign: "center" as const,
	marginTop: "16px",
};

const link = {
	color: "#5469d4",
	textDecoration: "underline",
};
