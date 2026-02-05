import Image from "next/image";
import Link from "next/link";

export default function Design19() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Avenir', 'Nunito Sans', 'Trebuchet MS', sans-serif",
				backgroundColor: "#fafafa",
				color: "#333330",
			}}
		>
			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-6 lg:px-14">
				<div className="flex items-center gap-2">
					<div
						className="flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-md"
						style={{ backgroundColor: "#333330" }}
					>
						Z8
					</div>
					<span className="text-[13px] font-semibold text-[#aaaa99]">Z8</span>
				</div>
				<nav className="hidden items-center gap-9 text-[13px] font-medium text-[#aaaa99] md:flex">
					<a href="#features" className="transition-colors hover:text-[#333330]">Funktionen</a>
					<a href="#layers" className="transition-colors hover:text-[#333330]">Aufbau</a>
					<a href="#contact" className="transition-colors hover:text-[#333330]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="rounded-lg px-5 py-2.5 text-[12px] font-semibold text-white shadow-md transition-transform hover:scale-[1.02]"
					style={{ backgroundColor: "#333330" }}
				>
					Demo anfragen
				</a>
			</header>

			{/* Hero - paper fold concept */}
			<section className="relative z-10 px-8 pb-20 pt-24 lg:px-14">
				<div className="mx-auto max-w-4xl text-center">
					<p
						className="animate-fade-up mb-6 text-[11px] font-semibold uppercase tracking-[0.4em] text-[#aaaa99]"
						style={{ animationDelay: "0.1s" }}
					>
						Schicht f&uuml;r Schicht
					</p>
					<h1
						className="animate-fade-up text-[clamp(3rem,7vw,5.5rem)] font-bold leading-[1.05] tracking-[-0.03em]"
						style={{ animationDelay: "0.2s" }}
					>
						Zeiterfassung,
						<br />
						sorgf&auml;ltig <span style={{ color: "#aaaa99" }}>gefaltet</span>.
					</h1>
					<p
						className="animate-fade-up mx-auto mt-6 max-w-lg text-[15px] leading-[1.8] text-[#888880]"
						style={{ animationDelay: "0.35s" }}
					>
						Jede Ebene hat einen Zweck. GoBD-konform, modular aufgebaut, mit
						der Leichtigkeit von Papier und der Stabilit&auml;t von Stahl.
					</p>
				</div>
			</section>

			{/* Stacked card hero */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-14">
				<div className="animate-scale-in relative mx-auto max-w-4xl" style={{ animationDelay: "0.5s" }}>
					{/* Back layer */}
					<div
						className="absolute inset-x-6 top-4 h-[38vh] rounded-2xl"
						style={{ backgroundColor: "#f0f0ea", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
					/>
					{/* Middle layer */}
					<div
						className="absolute inset-x-3 top-2 h-[38vh] rounded-2xl"
						style={{ backgroundColor: "#f5f5f0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
					/>
					{/* Front layer - image */}
					<div
						className="relative h-[38vh] overflow-hidden rounded-2xl"
						style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}
					>
						<Image
							src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80&auto=format&fit=crop"
							alt="Clean workspace"
							fill
							className="object-cover"
							priority
						/>
					</div>
				</div>
			</section>

			{/* Features - layered cards */}
			<section id="features" className="relative z-10 px-8 pb-24 lg:px-14">
				<div className="mb-14 text-center">
					<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#aaaa99]">Funktionen</p>
					<h2 className="text-2xl font-bold tracking-tight">Sechs Lagen Pr&auml;zision.</h2>
				</div>

				<div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2 lg:grid-cols-3">
					{[
						{ title: "Stempeluhr", desc: "Ein Klick. Alle Ger\u00e4te. Sofort synchron." },
						{ title: "GoBD-konform", desc: "Revisionssicher. Unver\u00e4nderbar. Gepr\u00fcft." },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio. Automatisiert." },
						{ title: "Teams", desc: "Abteilungen, Rollen, Berechtigungen. Klar." },
						{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Sicher integriert." },
						{ title: "Dashboards", desc: "\u00dcberstunden, Trends. Sofort sichtbar." },
					].map((f, i) => (
						<div
							key={i}
							className="group relative rounded-xl bg-white p-6 transition-all hover:-translate-y-1"
							style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.04)", border: "1px solid #f0f0ea" }}
						>
							{/* Paper fold corner */}
							<div
								className="absolute right-0 top-0 h-5 w-5 transition-all duration-300 group-hover:h-7 group-hover:w-7"
								style={{
									background: "linear-gradient(135deg, #fafafa 50%, #e8e8e0 50%)",
									borderBottomLeft: "1px solid #e8e8e0",
								}}
							/>
							<h3 className="mb-2 text-[15px] font-bold tracking-tight">{f.title}</h3>
							<p className="text-[12px] leading-[1.7] text-[#aaaa99]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-14">
				<div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-5">
					<div className="relative h-56 overflow-hidden rounded-xl md:col-span-3" style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" />
					</div>
					<div className="relative h-56 overflow-hidden rounded-xl md:col-span-2" style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover" />
					</div>
				</div>
			</section>

			{/* Layers section */}
			<section id="layers" className="relative z-10 px-8 py-20 lg:px-14" style={{ backgroundColor: "#f5f5f0" }}>
				<div className="mx-auto max-w-xl text-center">
					<h2 className="mb-4 text-2xl font-bold tracking-tight">Einfachheit hat Tiefe.</h2>
					<p className="text-[15px] leading-[1.8] text-[#888880]">
						Unter der schlichten Oberfl&auml;che verbirgt sich durchdachte Architektur.
						Jede Schicht &mdash; vom Interface bis zur Datenbank &mdash; ist mit Absicht gestaltet.
					</p>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-14">
				<div
					className="mx-auto max-w-2xl rounded-2xl bg-white p-12 text-center"
					style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.06)", border: "1px solid #f0f0ea" }}
				>
					<h2 className="mb-4 text-2xl font-bold tracking-tight">Lassen Sie uns entfalten.</h2>
					<p className="mb-8 text-[14px] leading-relaxed text-[#aaaa99]">
						In einer Demo zeigen wir Ihnen jede Schicht von Z8.
					</p>
					<a
						href="mailto:hello@z8.app"
						className="inline-block rounded-lg px-8 py-3.5 text-[13px] font-semibold text-white shadow-md transition-transform hover:scale-[1.02]"
						style={{ backgroundColor: "#333330" }}
					>
						Demo vereinbaren
					</a>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-14" style={{ borderTop: "1px solid #f0f0ea" }}>
				<div className="flex items-center justify-between text-[11px] text-[#ccccbb]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#333330]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
