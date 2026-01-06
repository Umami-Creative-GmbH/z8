"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

const quotes = [
  {
    quote: "Zeit ist relativ. Vor allem Montagmorgen.",
    author: "Albert Einstein",
  },
  {
    quote: "Ich hatte heute viel vor - jetzt hab ich morgen viel vor.",
    author: "Konfuzius",
  },
  {
    quote: "Zeit ist Geld. Deshalb bin ich immer pleite.",
    author: "Dagobert Duck",
  },
  {
    quote: "Wer zu spät kommt, hat wenigstens noch was erlebt.",
    author: "Christopher Columbus",
  },
  {
    quote:
      "Ich verschwende meine Zeit nicht - ich investiere sie kreativ in Nonsens.",
    author: "Salvador Dalí",
  },
  {
    quote:
      "Zeitmanagement ist, wenn du fünf Stunden lang Listen schreibst, was du in einer erledigen wolltest.",
    author: "Marie Kondo",
  },
  { quote: "Meine innere Uhr geht nach Netflix.", author: "Platon" },
  {
    quote: "Zeit vergeht wie im Flug - besonders wenn du nichts tust.",
    author: "Wright-Brüder",
  },
  {
    quote:
      "Ich habe keine Zeit - ich bin nämlich gerade damit beschäftigt, keine Zeit zu haben.",
    author: "Stephen Hawking",
  },
  {
    quote:
      "Wenn du glaubst, du hast die Zeit im Griff, kommt der Kalender und lacht dich aus.",
    author: "Napoleon",
  },
  {
    quote: "Der frühe Vogel kann mich mal - ich warte auf die snoozende Eule.",
    author: "Friedrich Nietzsche",
  },
  {
    quote: "Ich habe alle Zeit der Welt - sie gehört nur nicht mir.",
    author: "Schrödingers Katze",
  },
  {
    quote:
      "Die besten Pläne macht man fünf Minuten, bevor man schlafen sollte.",
    author: "Elon Musk",
  },
  {
    quote: "Multitasking ist, wenn man viele Dinge gleichzeitig halb vergisst.",
    author: "Homer Simpson",
  },
  {
    quote:
      "Zeitreisen sind möglich - ich bin heute geistig noch im Wochenende.",
    author: "Doctor Who",
  },
  {
    quote: "Ich habe so viel Zeit, dass ich sie erst mal verlegt habe.",
    author: "Heinrich VIII.",
  },
  {
    quote: "Meine To-do-Liste ist ein Museum der guten Absichten.",
    author: "Kant",
  },
  {
    quote: "Zeit ist wie eine Socke - immer eine fehlt.",
    author: "Albert Wesker",
  },
  { quote: "Früher war mehr später.", author: "Yoda" },
  {
    quote:
      "Ich bin pünktlich - innerhalb meines persönlichen Zeitzonen-Systems.",
    author: "Gandalf",
  },
  {
    quote: "Ich hab keine Zeit. Ich hab Termine mit meinem Sofa.",
    author: "Hannibal Lecter",
  },
  {
    quote: "Das Meeting hätte auch ein Nachmittagsschläfchen sein können.",
    author: "Angela Merkel",
  },
  { quote: "Die Uhr tickt, aber ich hör lieber Musik.", author: "Mozart" },
  {
    quote:
      "Ich hab versucht, Zeit zu sparen. Jetzt hab ich sie irgendwo verloren.",
    author: "Sherlock Holmes",
  },
  {
    quote: "Zwischen Deadline und Wahnsinn passt genau ein Kaffee.",
    author: "Ludwig van Beethoven",
  },
  {
    quote: "Zeit ist wie Ketchup - kommt erst nichts, dann alles auf einmal.",
    author: "Heinz",
  },
  {
    quote:
      "Ich bin nicht spät - ich folge einfach einem alternativen Zeitstrahl.",
    author: "Rick Sanchez",
  },
  {
    quote:
      "Wenn's eilig ist, mach ich erst mal gar nichts. Muss ja gut werden.",
    author: "Konrad Adenauer",
  },
  {
    quote: "Ich bin ein Frühaufsteher - sobald es nach Mittag riecht.",
    author: "Oscar Wilde",
  },
  {
    quote:
      "Zeit ist ein Konzept, das ich nur akzeptiere, wenn Essen involviert ist.",
    author: "Garfield",
  },
];

export default function QuoteBox() {
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
  }, []);

  // Don't render until mounted to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="absolute right-1 bottom-1 flex max-w-1/2 flex-col items-end rounded-md bg-card/40 p-2 text-muted-foreground text-xs opacity-50 backdrop-blur-xs">
        <p className="text-justify font-semibold">„{quotes[0].quote}"</p>
        <p className="text-gray-500 italic">- {quotes[0].author}</p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        animate={{ opacity: 1 }}
        className="absolute right-1 bottom-1 flex max-w-1/2 flex-col items-end rounded-md bg-card/40 p-2 text-muted-foreground text-xs opacity-50 backdrop-blur-xs"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        key={currentIndex}
        transition={{ duration: 0.8 }}
      >
        <p className="text-justify font-semibold">
          „{quotes[currentIndex].quote}"
        </p>
        <p className="text-gray-500 italic">- {quotes[currentIndex].author}</p>
      </motion.div>
    </AnimatePresence>
  );
}
