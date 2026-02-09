import Image from "next/image";
import Link from "next/link";

export default function DesignS2() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Nunito', 'Quicksand', 'Varela Round', sans-serif",
				backgroundColor: "#f5f0eb",
				color: "#3a3530",
			}}
		>
			{/* Header */}
			<header className="flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-center gap-3">
					<div
						className="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-extrabold"
						style={{ backgroundColor: "#d4c5b5", color: "#5a4f44" }}
					>
						Z8
					</div>
					<span className="text-[11px] font-semibold tracking-[0.15em] uppercase" style={{ color: "#9a8e80" }}>
						Zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-8 text-[13px] font-semibold md:flex" style={{ color: "#8a7e70" }}>
					<a href="#features" className="transition-colors hover:text-[#5a4f44]">Funktionen</a>
					<a href="#how" className="transition-colors hover:text-[#5a4f44]">So gehts</a>
					<a href="#contact" className="transition-colors hover:text-[#5a4f44]">Preise</a>
				</nav>
				<a
					href="#contact"
					className="rounded-full px-6 py-2.5 text-[13px] font-bold transition-all hover:shadow-lg"
					style={{ backgroundColor: "#5a4f44", color: "#f5f0eb" }}
				>
					Loslegen
				</a>
			</header>

			{/* Hero */}
			<section className="flex min-h-[85vh] flex-col items-center justify-center px-8 text-center lg:px-16">
				{/* Hero image — organic pebble shape */}
				<div className="animate-scale-in relative mb-12" style={{ animationDelay: "0s" }}>
					<div className="flex items-end gap-4">
						<div className="relative overflow-hidden" style={{ width: 200, height: 140, borderRadius: "42% 58% 55% 45% / 60% 45% 55% 40%" }}>
							<Image src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.5) sepia(0.2)" }} />
						</div>
						<div className="relative overflow-hidden" style={{ width: 120, height: 100, borderRadius: "55% 45% 48% 52% / 45% 55% 50% 50%" }}>
							<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=300&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.5) sepia(0.2)" }} />
						</div>
					</div>
				</div>

				<p
					className="animate-fade-up text-[12px] font-bold tracking-[0.25em] uppercase"
					style={{ color: "#9a8e80", animationDelay: "0.1s" }}
				>
					Einfach. Natürlich. Zuverlässig.
				</p>

				<h1
					className="animate-fade-up mt-6 text-[clamp(2.5rem,6vw,4.5rem)] font-extrabold leading-[1.08] tracking-[-0.03em]"
					style={{ color: "#3a3530", animationDelay: "0.25s" }}
				>
					Zeiterfassung,
					<br />
					die sich <span style={{ color: "#8a7e70" }}>anfühlt</span>
					<br />
					wie Natur.
				</h1>

				<p
					className="animate-fade-up mt-8 max-w-lg text-[16px] leading-[1.75]"
					style={{ color: "#7a7068", animationDelay: "0.4s" }}
				>
					Rund geschliffen, glatt und verlässlich — Z8 ist das Werkzeug,
					das in der Hand liegt, als wäre es schon immer da gewesen.
				</p>

				<div className="animate-fade-up mt-10 flex items-center gap-4" style={{ animationDelay: "0.55s" }}>
					<a
						href="#contact"
						className="rounded-full px-8 py-3.5 text-[13px] font-bold transition-all hover:shadow-lg"
						style={{ backgroundColor: "#5a4f44", color: "#f5f0eb" }}
					>
						Kostenlos testen
					</a>
					<a
						href="#features"
						className="rounded-full px-8 py-3.5 text-[13px] font-bold transition-all hover:bg-[#e8ddd0]"
						style={{ border: "2px solid #c4b5a0", color: "#5a4f44" }}
					>
						Entdecken
					</a>
				</div>
			</section>

			{/* Features — rounded cards */}
			<section id="features" className="px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<h2
						className="text-center text-[clamp(1.8rem,3.5vw,2.8rem)] font-extrabold tracking-[-0.02em]"
						style={{ color: "#3a3530" }}
					>
						Glatt geschliffen
					</h2>
					<p className="mt-3 text-center text-[15px]" style={{ color: "#8a7e70" }}>
						Jede Funktion, reduziert auf ihre beste Form.
					</p>

					<div className="mt-16 grid gap-6 md:grid-cols-3">
						{[
							{
								icon: "◷",
								title: "Ein-Klick Stempel",
								desc: "Kein Formular, kein Suchen. Antippen und die Zeit läuft.",
							},
							{
								icon: "◑",
								title: "Live Dashboard",
								desc: "Alle Daten in Echtzeit, klar sortiert und sofort verständlich.",
							},
							{
								icon: "◈",
								title: "Team-Übersicht",
								desc: "Wer arbeitet, wer pausiert — auf einen Blick für Ihr ganzes Team.",
							},
						].map((f) => (
							<div
								key={f.title}
								className="rounded-[24px] p-8 transition-all hover:shadow-lg"
								style={{ backgroundColor: "#ede5db" }}
							>
								<div
									className="flex h-14 w-14 items-center justify-center rounded-full text-[24px]"
									style={{ backgroundColor: "#d4c5b5", color: "#5a4f44" }}
								>
									{f.icon}
								</div>
								<h3 className="mt-5 text-[17px] font-extrabold" style={{ color: "#3a3530" }}>
									{f.title}
								</h3>
								<p className="mt-2 text-[14px] leading-[1.7]" style={{ color: "#7a7068" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* How it works — steps */}
			<section id="how" className="px-8 py-24 lg:px-16" style={{ backgroundColor: "#ede5db" }}>
				<div className="mx-auto max-w-4xl">
					<h2
						className="text-center text-[clamp(1.8rem,3.5vw,2.8rem)] font-extrabold tracking-[-0.02em]"
						style={{ color: "#3a3530" }}
					>
						In drei Schritten
					</h2>
					<div className="mt-16 flex flex-col gap-12">
						{[
							{ step: "01", title: "Registrieren", desc: "Konto erstellen in unter einer Minute. Keine Kreditkarte." },
							{ step: "02", title: "Team einladen", desc: "Mitarbeiter per Link hinzufügen. Sofort einsatzbereit." },
							{ step: "03", title: "Zeit erfassen", desc: "Stempeln, pausieren, Berichte ziehen. Fertig." },
						].map((s) => (
							<div key={s.step} className="flex items-start gap-8">
								<div
									className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-[18px] font-extrabold"
									style={{ backgroundColor: "#d4c5b5", color: "#5a4f44" }}
								>
									{s.step}
								</div>
								<div>
									<h3 className="text-[20px] font-extrabold" style={{ color: "#3a3530" }}>
										{s.title}
									</h3>
									<p className="mt-1 text-[15px] leading-[1.7]" style={{ color: "#7a7068" }}>
										{s.desc}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="px-8 py-12 lg:px-16">
				<div className="mx-auto max-w-5xl grid gap-6 md:grid-cols-2">
					<div className="relative h-72 overflow-hidden rounded-[24px]">
						<Image src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.6) sepia(0.15)" }} />
					</div>
					<div className="relative h-72 overflow-hidden rounded-[24px]">
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.6) sepia(0.15)" }} />
					</div>
				</div>
			</section>

			{/* CTA */}
			<section id="contact" className="flex flex-col items-center px-8 py-32 text-center lg:px-16">
				<h2
					className="text-[clamp(2rem,4vw,3.2rem)] font-extrabold leading-[1.1] tracking-[-0.02em]"
					style={{ color: "#3a3530" }}
				>
					Bereit für etwas
					<br />
					<span style={{ color: "#8a7e70" }}>Rundes</span>?
				</h2>
				<a
					href="#"
					className="mt-10 rounded-full px-10 py-4 text-[14px] font-bold transition-all hover:shadow-lg"
					style={{ backgroundColor: "#5a4f44", color: "#f5f0eb" }}
				>
					Jetzt kostenlos starten
				</a>
			</section>

			{/* Footer */}
			<footer className="px-8 py-8 lg:px-16" style={{ borderTop: "2px solid #e0d6cc" }}>
				<div className="flex items-center justify-between">
					<span className="text-[12px] font-semibold" style={{ color: "#9a8e80" }}>
						© 2025 Z8
					</span>
					<Link href="/" className="text-[12px] font-semibold transition-colors hover:text-[#5a4f44]" style={{ color: "#9a8e80" }}>
						← Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
