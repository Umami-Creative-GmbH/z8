import { Body, Container, Head, Heading, Hr, Html, Link, Section, Text } from "react-email";

interface AbsenceRecordedByManagerProps {
	employeeName: string;
	managerName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	appUrl: string;
}

export function AbsenceRecordedByManager({
	employeeName,
	managerName,
	startDate,
	endDate,
	absenceType,
	days,
	appUrl,
}: AbsenceRecordedByManagerProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Absence Recorded</Heading>
					<Text style={text}>Hi {employeeName},</Text>
					<Text style={text}>
						{managerName} recorded an absence on your behalf. It has been added to your
						absence records.
					</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Type</Text>
						<Text style={detailValue}>{absenceType}</Text>

						<Text style={detailLabel}>Dates</Text>
						<Text style={detailValue}>
							{startDate} - {endDate}
						</Text>

						<Text style={detailLabel}>Duration</Text>
						<Text style={detailValue}>{days} business days</Text>

						<Text style={detailLabel}>Recorded by</Text>
						<Text style={detailValue}>{managerName}</Text>
					</Section>

					<Text style={text}>If this does not look right, contact your manager.</Text>

					<Hr style={hr} />

					<Text style={footer}>
						<Link href={`${appUrl}/absences`} style={link}>
							View My Absences
						</Link>
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default AbsenceRecordedByManager;

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
	backgroundColor: "#eff6ff",
	borderRadius: "8px",
	margin: "24px 40px",
	padding: "24px",
	border: "1px solid #bfdbfe",
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

const link = {
	color: "#5469d4",
	textDecoration: "underline",
};
