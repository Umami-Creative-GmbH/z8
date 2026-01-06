import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Section,
	Text,
} from "@react-email/components";

interface PasswordResetProps {
	userName: string;
	resetUrl: string;
}

export function PasswordReset({ userName, resetUrl }: PasswordResetProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Reset Your Password</Heading>
					<Text style={text}>Hi {userName},</Text>
					<Text style={text}>
						We received a request to reset your password. Click the button below to create a new
						password for your account.
					</Text>

					<Section style={buttonContainer}>
						<Button style={button} href={resetUrl}>
							Reset Password
						</Button>
					</Section>

					<Text style={text}>
						If the button doesn't work, you can also copy and paste this link into your browser:
					</Text>
					<Text style={linkText}>{resetUrl}</Text>

					<Hr style={hr} />

					<Text style={footer}>
						If you didn't request a password reset, you can safely ignore this email. Your password
						will remain unchanged.
					</Text>

					<Text style={footer}>This link will expire in 1 hour for security reasons.</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default PasswordReset;

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

const buttonContainer = {
	padding: "27px 40px",
	textAlign: "center" as const,
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

const linkText = {
	color: "#5469d4",
	fontSize: "14px",
	lineHeight: "24px",
	padding: "0 40px",
	wordBreak: "break-all" as const,
};

const hr = {
	borderColor: "#e6ebf1",
	margin: "20px 40px",
};

const footer = {
	color: "#8898aa",
	fontSize: "14px",
	lineHeight: "24px",
	padding: "0 40px",
	textAlign: "center" as const,
};
