import Image from "next/image";
import Link from "next/link";

export default function DesignS6() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Caveat', 'Patrick Hand', 'Kalam', cursive",
				backgroundColor: "#1a1a18",
				color: "#d8d4c8",
			}}
		>
			{/* Chalkboard texture overlay */}
			<div
				className="pointer-events-none fixed inset-0 z-[1]"
				style={{
					background:
						"radial-gradient(ellipse 100% 80% at 50% 50%, rgba(30,30,28,0.3) 0%, rgba(20,20,18,0.8) 100%)",
				}}
			/>

			{/* Chalk dust particles */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(circle 2px at 20% 30%, rgba(255,255,240,0.04) 0%, transparent 100%), radial-gradient(circle 1px at 60% 15%, rgba(255,255,240,0.03) 0%, transparent 100%), radial-gradient(circle 2px at 80% 70%, rgba(255,255,240,0.04) 0%, transparent 100%), radial-gradient(circle 1px at 35% 85%, rgba(255,255,240,0.03) 0%, transparent 100%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-baseline gap-3">
					<span className="text-[28px] font-bold" style={{ color: "#e8e4d4" }}>
						Z8
					</span>
					<span
						className="text-[14px]"
						style={{
							color: "#6a6858",
							fontFamily: "'Caveat', cursive",
						}}
					>
						~ Zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-8 text-[16px] md:flex" style={{ color: "#7a7668" }}>
					<a href="#features" className="transition-colors hover:text-[#e8e4d4]">Funktionen</a>
					<a href="#sketch" className="transition-colors hover:text-[#e8e4d4]">Skizze</a>
					<a href="#contact" className="transition-colors hover:text-[#e8e4d4]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="rounded-none px-5 py-2 text-[16px] transition-all hover:bg-[#e8e4d4] hover:text-[#1a1a18]"
					style={{
						border: "2px dashed #5a5848",
						color: "#b8b4a4",
					}}
				>
					Los gehts!
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 flex min-h-[88vh] flex-col justify-center px-8 lg:px-16">
				<div className="max-w-3xl">
					{/* Hand-drawn underline effect via SVG */}
					<p
						className="animate-fade-up text-[18px]"
						style={{ color: "#7a7668", animationDelay: "0.1s" }}
					>
						* notiert am Whiteboard:
					</p>

					<h1
						className="animate-fade-up mt-6 text-[clamp(3rem,8vw,6.5rem)] leading-[1.0] tracking-[-0.02em]"
						style={{ color: "#e8e4d4", animationDelay: "0.25s" }}
					>
						Zeit
						<br />
						<span
							style={{
								textDecoration: "underline",
								textDecorationStyle: "wavy",
								textDecorationColor: "rgba(200,180,100,0.4)",
								textUnderlineOffset: "8px",
							}}
						>
							aufschreiben
						</span>
						<br />
						<span style={{ color: "#8a8474" }}>war nie</span>
						<br />
						so einfach.
					</h1>

					<p
						className="animate-fade-up mt-10 max-w-md text-[20px] leading-[1.7]"
						style={{ color: "#7a7668", animationDelay: "0.4s" }}
					>
						Kein fancy Dashboard nötig. Kein Schnickschnack.
						Z8 ist wie ein Block und ein Stift — nur digital.
					</p>

					<div className="animate-fade-up mt-12 flex items-center gap-6" style={{ animationDelay: "0.55s" }}>
						<a
							href="#contact"
							className="px-8 py-3.5 text-[18px] font-bold transition-all hover:bg-[#f0ecdc] hover:text-[#1a1a18]"
							style={{
								backgroundColor: "#d8d4c8",
								color: "#1a1a18",
								transform: "rotate(-1deg)",
							}}
						>
							Jetzt ausprobieren ✎
						</a>
					</div>
				</div>

				{/* Hero image — chalkboard-treated photo */}
				<div
					className="animate-fade-in absolute right-[6%] top-[15%] hidden overflow-hidden lg:block"
					style={{
						animationDelay: "0.6s",
						width: 300,
						height: 380,
						border: "2px dashed rgba(200,196,180,0.1)",
						transform: "rotate(1.5deg)",
					}}
				>
					<Image
						src="https://images.unsplash.com/photo-1517842645767-c639042777db?w=600&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0) brightness(0.35) contrast(1.4)" }}
					/>
					<div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(26,26,24,0.2), rgba(26,26,24,0.6))" }} />
					<div className="absolute bottom-4 left-4 text-[14px]" style={{ color: "rgba(200,196,180,0.4)" }}>
						~ skizze
					</div>
				</div>
			</section>

			{/* Features — notebook style */}
			<section id="features" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-auto max-w-4xl">
					<h2
						className="text-[clamp(2rem,4vw,3.5rem)]"
						style={{ color: "#e8e4d4" }}
					>
						Was Z8 kann:
					</h2>

					<div className="mt-12 space-y-6">
						{[
							{ bullet: "→", title: "Stempeln", desc: "Ein Klick, die Zeit läuft. Nochmal klicken, Feierabend." },
							{ bullet: "→", title: "Übersicht", desc: "Wer hat wann was gemacht? Alles auf einer Seite." },
							{ bullet: "→", title: "Export", desc: "Daten raus als CSV oder PDF. Für den Steuerberater." },
							{ bullet: "→", title: "Team", desc: "Mitarbeiter einladen, Zeiten vergleichen, fertig." },
						].map((f) => (
							<div
								key={f.title}
								className="flex items-start gap-4 pb-6"
								style={{ borderBottom: "1px dashed rgba(200,196,180,0.12)" }}
							>
								<span className="text-[24px] leading-none" style={{ color: "#8a8474" }}>
									{f.bullet}
								</span>
								<div>
									<h3 className="text-[22px]" style={{ color: "#d8d4c8" }}>
										{f.title}
									</h3>
									<p className="mt-1 text-[17px] leading-[1.6]" style={{ color: "#6a6858" }}>
										{f.desc}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 mx-8 mb-16 lg:mx-16">
				<div className="grid gap-6 md:grid-cols-2">
					{[
						"https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1456324504439-367cee3b3c32?w=800&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div
							key={i}
							className="relative h-56 overflow-hidden"
							style={{ border: "2px dashed rgba(200,196,180,0.1)", transform: i === 0 ? "rotate(-0.5deg)" : "rotate(0.5deg)" }}
						>
							<Image src={src} alt="" fill className="object-cover" style={{ filter: "saturate(0) brightness(0.5) contrast(1.3)" }} />
						</div>
					))}
				</div>
			</section>

			{/* Sketch section */}
			<section id="sketch" className="relative z-10 flex flex-col items-center px-8 py-24 text-center lg:px-16">
				<div
					className="inline-block px-12 py-8"
					style={{
						border: "2px dashed rgba(200,196,180,0.15)",
						transform: "rotate(-0.5deg)",
					}}
				>
					<p className="text-[22px]" style={{ color: "#8a8474" }}>
						&ldquo;Manchmal ist ein Stift alles, was man braucht.&rdquo;
					</p>
					<p className="mt-4 text-[16px]" style={{ color: "#5a5848" }}>
						— Das Z8 Team
					</p>
				</div>
			</section>

			{/* CTA */}
			<section id="contact" className="relative z-10 flex flex-col items-center px-8 py-32 text-center lg:px-16">
				<h2
					className="text-[clamp(2.2rem,5vw,4rem)] leading-[1.1]"
					style={{ color: "#e8e4d4" }}
				>
					Stift gezückt?
				</h2>
				<a
					href="#"
					className="mt-10 px-10 py-4 text-[20px] font-bold transition-all hover:bg-[#f0ecdc] hover:text-[#1a1a18]"
					style={{
						backgroundColor: "#d8d4c8",
						color: "#1a1a18",
						transform: "rotate(0.5deg)",
					}}
				>
					Jetzt starten ✎
				</a>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px dashed rgba(200,196,180,0.1)" }}>
				<div className="flex items-center justify-between">
					<span className="text-[14px]" style={{ color: "#4a4838" }}>
						© 2025 Z8
					</span>
					<Link href="/" className="text-[14px] transition-colors hover:text-[#e8e4d4]" style={{ color: "#5a5848" }}>
						← Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
