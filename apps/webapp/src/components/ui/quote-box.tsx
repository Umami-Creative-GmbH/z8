"use client";

import { useTranslate } from "@tolgee/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

const getQuotes = (t: (key: string, defaultValue: string) => string) => [
	{
		quote: t("quotes.0.text", "Zeit ist relativ. Vor allem Montagmorgen."),
		author: t("quotes.0.author", "Albert Einstein"),
	},
	{
		quote: t("quotes.1.text", "Ich hatte heute viel vor - jetzt hab ich morgen viel vor."),
		author: t("quotes.1.author", "Konfuzius"),
	},
	{
		quote: t("quotes.2.text", "Zeit ist Geld. Deshalb bin ich immer pleite."),
		author: t("quotes.2.author", "Dagobert Duck"),
	},
	{
		quote: t("quotes.3.text", "Wer zu spät kommt, hat wenigstens noch was erlebt."),
		author: t("quotes.3.author", "Christopher Columbus"),
	},
	{
		quote: t(
			"quotes.4.text",
			"Ich verschwende meine Zeit nicht - ich investiere sie kreativ in Nonsens.",
		),
		author: t("quotes.4.author", "Salvador Dalí"),
	},
	{
		quote: t(
			"quotes.5.text",
			"Zeitmanagement ist, wenn du fünf Stunden lang Listen schreibst, was du in einer erledigen wolltest.",
		),
		author: t("quotes.5.author", "Marie Kondo"),
	},
	{
		quote: t("quotes.6.text", "Meine innere Uhr geht nach Netflix."),
		author: t("quotes.6.author", "Platon"),
	},
	{
		quote: t("quotes.7.text", "Zeit vergeht wie im Flug - besonders wenn du nichts tust."),
		author: t("quotes.7.author", "Wright-Brüder"),
	},
	{
		quote: t(
			"quotes.8.text",
			"Ich habe keine Zeit - ich bin nämlich gerade damit beschäftigt, keine Zeit zu haben.",
		),
		author: t("quotes.8.author", "Stephen Hawking"),
	},
	{
		quote: t(
			"quotes.9.text",
			"Wenn du glaubst, du hast die Zeit im Griff, kommt der Kalender und lacht dich aus.",
		),
		author: t("quotes.9.author", "Napoleon"),
	},
	{
		quote: t("quotes.10.text", "Der frühe Vogel kann mich mal - ich warte auf die snoozende Eule."),
		author: t("quotes.10.author", "Friedrich Nietzsche"),
	},
	{
		quote: t("quotes.11.text", "Ich habe alle Zeit der Welt - sie gehört nur nicht mir."),
		author: t("quotes.11.author", "Schrödingers Katze"),
	},
	{
		quote: t(
			"quotes.12.text",
			"Die besten Pläne macht man fünf Minuten, bevor man schlafen sollte.",
		),
		author: t("quotes.12.author", "Elon Musk"),
	},
	{
		quote: t(
			"quotes.13.text",
			"Multitasking ist, wenn man viele Dinge gleichzeitig halb vergisst.",
		),
		author: t("quotes.13.author", "Homer Simpson"),
	},
	{
		quote: t(
			"quotes.14.text",
			"Zeitreisen sind möglich - ich bin heute geistig noch im Wochenende.",
		),
		author: t("quotes.14.author", "Doctor Who"),
	},
	{
		quote: t("quotes.15.text", "Ich habe so viel Zeit, dass ich sie erst mal verlegt habe."),
		author: t("quotes.15.author", "Heinrich VIII."),
	},
	{
		quote: t("quotes.16.text", "Meine To-do-Liste ist ein Museum der guten Absichten."),
		author: t("quotes.16.author", "Kant"),
	},
	{
		quote: t("quotes.17.text", "Zeit ist wie eine Socke - immer eine fehlt."),
		author: t("quotes.17.author", "Albert Wesker"),
	},
	{
		quote: t("quotes.18.text", "Früher war mehr später."),
		author: t("quotes.18.author", "Yoda"),
	},
	{
		quote: t(
			"quotes.19.text",
			"Ich bin pünktlich - innerhalb meines persönlichen Zeitzonen-Systems.",
		),
		author: t("quotes.19.author", "Gandalf"),
	},
	{
		quote: t("quotes.20.text", "Ich hab keine Zeit. Ich hab Termine mit meinem Sofa."),
		author: t("quotes.20.author", "Hannibal Lecter"),
	},
	{
		quote: t("quotes.21.text", "Das Meeting hätte auch ein Nachmittagsschläfchen sein können."),
		author: t("quotes.21.author", "Angela Merkel"),
	},
	{
		quote: t("quotes.22.text", "Die Uhr tickt, aber ich hör lieber Musik."),
		author: t("quotes.22.author", "Mozart"),
	},
	{
		quote: t(
			"quotes.23.text",
			"Ich hab versucht, Zeit zu sparen. Jetzt hab ich sie irgendwo verloren.",
		),
		author: t("quotes.23.author", "Sherlock Holmes"),
	},
	{
		quote: t("quotes.24.text", "Zwischen Deadline und Wahnsinn passt genau ein Kaffee."),
		author: t("quotes.24.author", "Ludwig van Beethoven"),
	},
	{
		quote: t("quotes.25.text", "Zeit ist wie Ketchup - kommt erst nichts, dann alles auf einmal."),
		author: t("quotes.25.author", "Heinz"),
	},
	{
		quote: t(
			"quotes.26.text",
			"Ich bin nicht spät - ich folge einfach einem alternativen Zeitstrahl.",
		),
		author: t("quotes.26.author", "Rick Sanchez"),
	},
	{
		quote: t(
			"quotes.27.text",
			"Wenn's eilig ist, mach ich erst mal gar nichts. Muss ja gut werden.",
		),
		author: t("quotes.27.author", "Konrad Adenauer"),
	},
	{
		quote: t("quotes.28.text", "Ich bin ein Frühaufsteher - sobald es nach Mittag riecht."),
		author: t("quotes.28.author", "Oscar Wilde"),
	},
	{
		quote: t(
			"quotes.29.text",
			"Zeit ist ein Konzept, das ich nur akzeptiere, wenn Essen involviert ist.",
		),
		author: t("quotes.29.author", "Garfield"),
	},
];

interface QuoteBoxProps {
	enabled?: boolean;
	customQuotes?: Array<{ quote: string; author: string }> | null;
}

export default function QuoteBox({ enabled = true, customQuotes }: QuoteBoxProps) {
	const { t } = useTranslate();
	const defaultQuotes = getQuotes(t);
	const quotes = customQuotes && customQuotes.length > 0 ? customQuotes : defaultQuotes;
	const [mounted, setMounted] = useState(false);
	const [currentIndex, setCurrentIndex] = useState(0);

	// Only shuffle on client-side after mount to prevent hydration mismatch
	useEffect(() => {
		setMounted(true);
		// Start with a fixed quote to ensure server/client match
		setCurrentIndex(0);

		const interval = setInterval(() => {
			setCurrentIndex((prev) => (prev + 1) % quotes.length);
		}, 1000 * 30); // 30 Sekunden pro Zitat

		return () => clearInterval(interval);
	}, [quotes.length]);

	// Don't render if quotes are disabled
	if (!enabled) {
		return null;
	}

	// Don't render until mounted to prevent hydration mismatch
	if (!mounted) {
		return (
			<div className="absolute right-1 bottom-1 flex max-w-1/2 flex-col items-end rounded-md bg-card/80 p-2 text-card-foreground text-xs backdrop-blur-sm">
				<p className="text-justify font-semibold">„{quotes[0].quote}"</p>
				<p className="opacity-70 italic">- {quotes[0].author}</p>
			</div>
		);
	}

	return (
		<AnimatePresence mode="wait">
			<motion.div
				animate={{ opacity: 1 }}
				className="absolute right-1 bottom-1 flex max-w-1/2 flex-col items-end rounded-md bg-card/80 p-2 text-card-foreground text-xs backdrop-blur-sm"
				exit={{ opacity: 0 }}
				initial={{ opacity: 0 }}
				key={currentIndex}
				transition={{ duration: 0.8 }}
			>
				<p className="text-justify font-semibold">„{quotes[currentIndex].quote}"</p>
				<p className="opacity-70 italic">- {quotes[currentIndex].author}</p>
			</motion.div>
		</AnimatePresence>
	);
}
