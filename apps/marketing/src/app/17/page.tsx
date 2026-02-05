import Image from "next/image";
import Link from "next/link";

export default function Design17() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Bodoni Moda', 'Didot', 'Georgia', serif",
				backgroundColor: "#0d0d0d",
				color: "#d4d0c8",
			}}
		>
			{/* Film grain overlay */}
			<div
				className="pointer-events-none fixed inset-0 z-50 opacity-[0.04]"
				style={{
					backgroundImage:
						"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
					backgroundRepeat: "repeat",
					backgroundSize: "200px 200px",
					mixBlendMode: "overlay",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-7 lg:px-16">
				<span className="text-xl font-bold italic tracking-wide">Z8</span>
				<nav className="hidden items-center gap-10 text-[12px] tracking-[0.15em] text-[#6a6660] md:flex">
					<a href="#features" className="transition-colors hover:text-[#d4d0c8]">Szenen</a>
					<a href="#about" className="transition-colors hover:text-[#d4d0c8]">Handlung</a>
					<a href="#contact" className="transition-colors hover:text-[#d4d0c8]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="text-[11px] italic tracking-[0.15em] text-[#6a6660] transition-colors hover:text-[#d4d0c8]"
				>
					Demo &rarr;
				</a>
			</header>

			<div className="mx-8 h-px lg:mx-16" style={{ backgroundColor: "#ffffff08" }} />

			{/* Hero - cinematic */}
			<section className="relative z-10 px-8 pb-8 pt-24 lg:px-16">
				<div className="mx-auto max-w-4xl">
					<p
						className="animate-fade-in mb-10 text-center text-[11px] uppercase tracking-[0.6em] text-[#4a4640]"
						style={{ animationDelay: "0.1s" }}
					>
						Ein Film von Z8
					</p>
					<h1
						className="animate-fade-up text-center text-[clamp(3.5rem,10vw,9rem)] font-bold italic leading-[0.9] tracking-[-0.02em]"
						style={{ animationDelay: "0.2s" }}
					>
						Zeit.
					</h1>
					<p
						className="animate-fade-up mx-auto mt-10 max-w-md text-center text-[15px] italic leading-[2] text-[#6a6660]"
						style={{ animationDelay: "0.4s" }}
					>
						Jede Sekunde z&auml;hlt. Jeder Eintrag bleibt. GoBD-konforme Zeiterfassung,
						inszeniert mit Pr&auml;zision.
					</p>
				</div>
			</section>

			{/* Cinematic hero image - letterboxed */}
			<section className="relative z-10 mx-8 mb-24 mt-16 lg:mx-16">
				<div className="animate-scale-in relative overflow-hidden" style={{ animationDelay: "0.5s", aspectRatio: "2.39/1" }}>
					<Image
						src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1800&q=80&auto=format&fit=crop"
						alt="Cinematic workspace"
						fill
						className="object-cover"
						style={{ filter: "grayscale(0.8) contrast(1.3) brightness(0.7)" }}
						priority
					/>
					<div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(13,13,13,0.3) 0%, rgba(13,13,13,0.6) 100%)" }} />
					{/* Letterbox bars */}
					<div className="absolute inset-x-0 top-0 h-[8%]" style={{ backgroundColor: "#0d0d0d" }} />
					<div className="absolute inset-x-0 bottom-0 h-[8%]" style={{ backgroundColor: "#0d0d0d" }} />
				</div>
			</section>

			{/* Features - act structure */}
			<section id="features" className="relative z-10 px-8 pb-24 lg:px-16">
				<p className="mb-16 text-center text-[10px] uppercase tracking-[0.5em] text-[#4a4640]">
					Akt I &mdash; Die Funktionen
				</p>

				<div className="mx-auto grid max-w-3xl gap-12 md:grid-cols-2">
					{[
						{ title: "Stempeluhr", desc: "Ein Klick. Alle Plattformen. Echtzeit-Sync." },
						{ title: "Revisionssicherheit", desc: "Unver\u00e4nderbar. GoBD-konform. Signiert." },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio. Automatisch." },
						{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Zero-Trust." },
					].map((f, i) => (
						<div key={i} className="group text-center">
							<h3 className="mb-3 text-xl italic tracking-wide">{f.title}</h3>
							<p className="text-[13px] leading-[1.9] text-[#5a5650]">{f.desc}</p>
							<div className="mx-auto mt-5 h-px w-8 transition-all duration-700 group-hover:w-16" style={{ backgroundColor: "#ffffff15" }} />
						</div>
					))}
				</div>
			</section>

			{/* Film still pair */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="grid gap-4 md:grid-cols-2">
					<div className="relative overflow-hidden" style={{ aspectRatio: "16/9" }}>
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "grayscale(0.7) contrast(1.2) brightness(0.6)" }} />
					</div>
					<div className="relative overflow-hidden" style={{ aspectRatio: "16/9" }}>
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "grayscale(0.7) contrast(1.2) brightness(0.6)" }} />
					</div>
				</div>
			</section>

			{/* About - monologue */}
			<section id="about" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-xl text-center">
					<p className="mb-10 text-[10px] uppercase tracking-[0.5em] text-[#4a4640]">
						Akt II &mdash; Die Vision
					</p>
					<blockquote className="text-[clamp(1.5rem,3vw,2.5rem)] italic leading-[1.4] tracking-tight">
						Die beste Zeiterfassung ist die, die man nicht sp&uuml;rt &mdash; nur ihre Wirkung.
					</blockquote>
					<div className="mx-auto mt-8 h-px w-12" style={{ backgroundColor: "#ffffff10" }} />
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-md text-center">
					<p className="mb-6 text-[10px] uppercase tracking-[0.5em] text-[#4a4640]">
						Abspann
					</p>
					<h2 className="mb-6 text-3xl italic tracking-wide">Bereit f&uuml;r Ihre Premiere?</h2>
					<p className="mb-10 text-[14px] italic leading-relaxed text-[#5a5650]">
						Erleben Sie Z8 in einer pers&ouml;nlichen Vorf&uuml;hrung.
					</p>
					<a
						href="mailto:hello@z8.app"
						className="inline-block px-8 py-3.5 text-[11px] tracking-[0.2em] text-[#0d0d0d] transition-opacity hover:opacity-80"
						style={{ backgroundColor: "#d4d0c8" }}
					>
						Demo vereinbaren
					</a>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #ffffff08" }}>
				<div className="flex items-center justify-between text-[10px] tracking-[0.2em] text-[#3a3630]">
					<span>&copy; 2025 Z8 Film</span>
					<Link href="/" className="transition-colors hover:text-[#d4d0c8]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
