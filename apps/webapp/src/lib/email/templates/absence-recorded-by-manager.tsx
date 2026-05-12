import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Preview,
	Section,
	Text,
} from "react-email";

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
			<Preview>An absence was recorded for you</Preview>
			<Body style={body}>
				<Container style={container}>
					<Heading style={h1}>Absence recorded</Heading>
					<Text style={text}>Hi {employeeName},</Text>
					<Text style={text}>
						{managerName} recorded {absenceType} for {startDate} to {endDate} ({days} days)
						on your behalf.
					</Text>
					<Section style={buttonContainer}>
						<Button style={button} href={`${appUrl}/absences`}>
							View absences
						</Button>
					</Section>
				</Container>
			</Body>
		</Html>
	);
}

const body = { backgroundColor: "#f6f9fc", fontFamily: "Arial, sans-serif" };
const container = { backgroundColor: "#ffffff", margin: "0 auto", padding: "32px", maxWidth: "560px" };
const h1 = { color: "#111827", fontSize: "24px", fontWeight: "600", margin: "0 0 20px" };
const text = { color: "#374151", fontSize: "16px", lineHeight: "24px" };
const buttonContainer = { marginTop: "24px" };
const button = {
	backgroundColor: "#2563eb",
	borderRadius: "6px",
	color: "#ffffff",
	padding: "12px 18px",
	textDecoration: "none",
};
