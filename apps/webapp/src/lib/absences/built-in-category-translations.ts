import type { BuiltInAbsenceCategoryType } from "./category-display";

/**
 * Seed data for organization-owned category translation fields, shared by seeding,
 * the settings editor and display fallbacks. Keep every shipped language covered.
 * These are category defaults, not generated Tolgee catalogs.
 */
export const builtInAbsenceCategoryTranslations: Record<
	string,
	Record<BuiltInAbsenceCategoryType, { name: string; description: string }>
> = {
	en: {
		vacation: { name: "Vacation", description: "Paid time off" },
		sick: { name: "Sick Leave", description: "Sick day" },
		personal: { name: "Personal Day", description: "Personal time off" },
		home_office: { name: "Home Office", description: "Remote work day" },
		unpaid: { name: "Unpaid Leave", description: "Unpaid absence" },
		parental: { name: "Parental Leave", description: "Parental leave absence" },
		bereavement: { name: "Bereavement", description: "Bereavement leave" },
		time_off_in_lieu: {
			description: "Time off taken against the work balance",
			name: "Time off in lieu",
		},
	},
	de: {
		vacation: { name: "Urlaub", description: "Bezahlte Freizeit" },
		sick: { name: "Krankheit", description: "Krankheitstag" },
		personal: {
			name: "Persönlich",
			description: "Freistellung aus persönlichen Gründen",
		},
		home_office: {
			name: "Homeoffice",
			description: "Arbeitstag im Homeoffice",
		},
		unpaid: { name: "Unbezahlt", description: "Unbezahlte Abwesenheit" },
		parental: {
			name: "Elternzeit",
			description: "Abwesenheit während der Elternzeit",
		},
		bereavement: {
			name: "Trauerfall",
			description: "Freistellung bei einem Trauerfall",
		},
		time_off_in_lieu: {
			description: "Vom Arbeitszeitsaldo abgezogene Abwesenheit",
			name: "Freizeitausgleich",
		},
	},
	fr: {
		vacation: { name: "Vacances", description: "Congé payé" },
		sick: { name: "Congé maladie", description: "Journée de maladie" },
		personal: {
			name: "Personnel",
			description: "Congé pour raisons personnelles",
		},
		home_office: { name: "Télétravail", description: "Journée de télétravail" },
		unpaid: { name: "Non rémunéré", description: "Absence non rémunérée" },
		parental: {
			name: "Congé parental",
			description: "Absence pour congé parental",
		},
		bereavement: {
			name: "Congé de deuil",
			description: "Congé à la suite d’un décès",
		},
		time_off_in_lieu: {
			description: "Congé pris sur le solde de travail",
			name: "Récupération",
		},
	},
	es: {
		vacation: { name: "Vacaciones", description: "Tiempo libre remunerado" },
		sick: { name: "Baja por enfermedad", description: "Día de enfermedad" },
		personal: {
			name: "Personal",
			description: "Permiso por motivos personales",
		},
		home_office: {
			name: "Trabajo desde casa",
			description: "Día de trabajo a distancia",
		},
		unpaid: { name: "No remunerado", description: "Ausencia no remunerada" },
		parental: {
			name: "Licencia parental",
			description: "Ausencia por licencia parental",
		},
		bereavement: { name: "Duelo", description: "Permiso por fallecimiento" },
		time_off_in_lieu: {
			description: "Tiempo libre descontado del saldo de trabajo",
			name: "Descanso compensatorio",
		},
	},
	it: {
		vacation: { name: "Ferie", description: "Ferie retribuite" },
		sick: { name: "Congedo per malattia", description: "Giorno di malattia" },
		personal: {
			name: "Personale",
			description: "Permesso per motivi personali",
		},
		home_office: {
			name: "Lavoro da casa",
			description: "Giornata di lavoro da remoto",
		},
		unpaid: { name: "Non retribuito", description: "Assenza non retribuita" },
		parental: {
			name: "Congedo parentale",
			description: "Assenza per congedo parentale",
		},
		bereavement: { name: "Lutto", description: "Congedo per lutto" },
		time_off_in_lieu: {
			description: "Permesso scalato dal saldo ore",
			name: "Riposo compensativo",
		},
	},
	pt: {
		vacation: { name: "Férias", description: "Tempo livre remunerado" },
		sick: { name: "Licença médica", description: "Dia de doença" },
		personal: { name: "Pessoal", description: "Licença por motivos pessoais" },
		home_office: { name: "Home Office", description: "Dia de trabalho remoto" },
		unpaid: { name: "Não remunerado", description: "Ausência não remunerada" },
		parental: {
			name: "Licença parental",
			description: "Ausência por licença parental",
		},
		bereavement: { name: "Luto", description: "Licença por falecimento" },
		time_off_in_lieu: {
			description: "Folga descontada do saldo de trabalho",
			name: "Folga compensatória",
		},
	},
	el: {
		vacation: { name: "Διακοπές", description: "Άδεια με αποδοχές" },
		sick: { name: "Αναρρωτική άδεια", description: "Ημέρα ασθένειας" },
		personal: {
			name: "Προσωπική",
			description: "Άδεια για προσωπικούς λόγους",
		},
		home_office: { name: "Τηλεργασία", description: "Ημέρα τηλεργασίας" },
		unpaid: { name: "Άνευ αποδοχών", description: "Απουσία άνευ αποδοχών" },
		parental: {
			name: "Γονική άδεια",
			description: "Απουσία λόγω γονικής άδειας",
		},
		bereavement: { name: "Πένθος", description: "Άδεια πένθους" },
		time_off_in_lieu: {
			description: "Άδεια που αφαιρείται από το υπόλοιπο εργασίας",
			name: "Αντισταθμιστική άδεια",
		},
	},
	pl: {
		vacation: { name: "Urlop wypoczynkowy", description: "Płatny urlop" },
		sick: { name: "Zwolnienie lekarskie", description: "Dzień choroby" },
		personal: { name: "Osobiste", description: "Wolne z powodów osobistych" },
		home_office: { name: "Praca zdalna", description: "Dzień pracy zdalnej" },
		unpaid: { name: "Bezpłatne", description: "Niepłatna nieobecność" },
		parental: {
			name: "Urlop rodzicielski",
			description: "Nieobecność z powodu urlopu rodzicielskiego",
		},
		bereavement: {
			name: "Żałoba",
			description: "Urlop z powodu śmierci bliskiej osoby",
		},
		time_off_in_lieu: {
			description: "Czas wolny rozliczany z bilansu czasu pracy",
			name: "Czas wolny za nadgodziny",
		},
	},
	tr: {
		vacation: { name: "Yıllık İzin", description: "Ücretli izin" },
		sick: { name: "Hastalık İzni", description: "Hastalık günü" },
		personal: { name: "Kişisel", description: "Kişisel nedenlerle izin" },
		home_office: { name: "Evden Çalışma", description: "Uzaktan çalışma günü" },
		unpaid: { name: "Ücretsiz İzin", description: "Ücretsiz devamsızlık" },
		parental: {
			name: "Ebeveyn İzni",
			description: "Ebeveyn izni nedeniyle devamsızlık",
		},
		bereavement: { name: "Yas İzni", description: "Vefat nedeniyle izin" },
		time_off_in_lieu: {
			description: "Çalışma bakiyesinden kullanılan izin",
			name: "Telafi izni",
		},
	},
	gsw: {
		vacation: { name: "Ferie", description: "Bezahlti Freiziit" },
		sick: { name: "Chrankheit", description: "Chrankheitstag" },
		personal: {
			name: "Persönlich",
			description: "Freiziit us persönliche Gründ",
		},
		home_office: {
			name: "Home Office",
			description: "Arbeitstag im Homeoffice",
		},
		unpaid: { name: "Unbezahlt", description: "Unbezahlt Abweseheit" },
		parental: {
			name: "Eltereurlaub",
			description: "Abweseheit während em Eltereurlaub",
		},
		bereavement: { name: "Todesfall", description: "Urlaub bi mene Todesfall" },
		time_off_in_lieu: {
			description: "Freiziit bezoge über de Arbeitsziitsaldo",
			name: "Freiziitusgliich",
		},
	},
	no: {
		vacation: { name: "Ferie", description: "Betalt fri" },
		sick: { name: "Sykefravær", description: "Sykedag" },
		personal: { name: "Personlig", description: "Fri av personlige grunner" },
		home_office: { name: "Hjemmekontor", description: "Dag med fjernarbeid" },
		unpaid: { name: "Ubetalt", description: "Ubetalt fravær" },
		parental: {
			name: "Foreldrepermisjon",
			description: "Fravær under foreldrepermisjon",
		},
		bereavement: {
			name: "Sorgpermisjon",
			description: "Permisjon ved dødsfall",
		},
		time_off_in_lieu: {
			description: "Fravær som trekkes fra arbeidssaldoen",
			name: "Avspasering",
		},
	},
	sv: {
		vacation: { name: "Semester", description: "Betald ledighet" },
		sick: { name: "Sjukfrånvaro", description: "Sjukdag" },
		personal: {
			name: "Personligt",
			description: "Ledighet av personliga skäl",
		},
		home_office: { name: "Hemkontor", description: "Dag med distansarbete" },
		unpaid: { name: "Obetald", description: "Obetald frånvaro" },
		parental: {
			name: "Föräldraledighet",
			description: "Frånvaro under föräldraledighet",
		},
		bereavement: {
			name: "Sorgeledighet",
			description: "Ledighet vid dödsfall",
		},
		time_off_in_lieu: {
			description: "Ledighet som tas från arbetssaldot",
			name: "Kompledighet",
		},
	},
	ro: {
		vacation: { name: "Concediu de odihnă", description: "Timp liber plătit" },
		sick: { name: "Concediu medical", description: "Zi de boală" },
		personal: {
			name: "Personal",
			description: "Concediu din motive personale",
		},
		home_office: {
			name: "Muncă de acasă",
			description: "Zi de muncă la distanță",
		},
		unpaid: { name: "Fără plată", description: "Absență fără plată" },
		parental: {
			name: "Concediu parental",
			description: "Absență pentru concediu parental",
		},
		bereavement: {
			name: "Deces în familie",
			description: "Concediu în caz de deces",
		},
		time_off_in_lieu: {
			description: "Timp liber dedus din soldul orelor de lucru",
			name: "Timp liber compensatoriu",
		},
	},
	hr: {
		vacation: { name: "Godišnji odmor", description: "Plaćeni dopust" },
		sick: { name: "Bolovanje", description: "Dan bolovanja" },
		personal: {
			name: "Osobni dopust",
			description: "Dopust iz osobnih razloga",
		},
		home_office: { name: "Rad od kuće", description: "Dan rada na daljinu" },
		unpaid: { name: "Neplaćeni dopust", description: "Neplaćena odsutnost" },
		parental: {
			name: "Roditeljski dopust",
			description: "Odsutnost tijekom roditeljskog dopusta",
		},
		bereavement: {
			name: "Smrtni slučaj",
			description: "Dopust zbog smrtnog slučaja",
		},
		time_off_in_lieu: {
			description: "Slobodno vrijeme na teret radnog salda",
			name: "Slobodno vrijeme u zamjenu",
		},
	},
	bs: {
		vacation: { name: "Godišnji odmor", description: "Plaćeno odsustvo" },
		sick: { name: "Bolovanje", description: "Dan bolovanja" },
		personal: { name: "Lično", description: "Odsustvo iz ličnih razloga" },
		home_office: { name: "Rad od kuće", description: "Dan rada na daljinu" },
		unpaid: { name: "Neplaćeno", description: "Neplaćeno odsustvo" },
		parental: {
			name: "Roditeljsko odsustvo",
			description: "Odsustvo tokom roditeljskog odsustva",
		},
		bereavement: {
			name: "Smrtni slučaj",
			description: "Odsustvo zbog smrtnog slučaja",
		},
		time_off_in_lieu: {
			description: "Slobodno vrijeme koje se oduzima od radnog salda",
			name: "Zamjensko slobodno vrijeme",
		},
	},
	sq: {
		vacation: { name: "Pushime", description: "Pushim me pagesë" },
		sick: { name: "Leje mjekësore", description: "Ditë sëmundjeje" },
		personal: { name: "Personale", description: "Leje për arsye personale" },
		home_office: {
			name: "Punë nga shtëpia",
			description: "Ditë pune në distancë",
		},
		unpaid: { name: "Pa pagesë", description: "Mungesë pa pagesë" },
		parental: {
			name: "Leje prindërore",
			description: "Mungesë për leje prindërore",
		},
		bereavement: { name: "Leje zie", description: "Leje për rast vdekjeje" },
		time_off_in_lieu: {
			description: "Leje e marrë në llogari të bilancit të punës",
			name: "Pushim kompensues",
		},
	},
	uk: {
		vacation: { name: "Відпустка", description: "Оплачувана відпустка" },
		sick: { name: "Лікарняний", description: "День хвороби" },
		personal: {
			name: "Особиста",
			description: "Відпустка за особистими обставинами",
		},
		home_office: {
			name: "Робота з дому",
			description: "День дистанційної роботи",
		},
		unpaid: {
			name: "Без збереження зарплати",
			description: "Неоплачувана відсутність",
		},
		parental: {
			name: "Відпустка по догляду за дитиною",
			description: "Відсутність у зв’язку з відпусткою для догляду за дитиною",
		},
		bereavement: {
			name: "Дні жалоби",
			description: "Відпустка у зв’язку зі смертю близької людини",
		},
		time_off_in_lieu: {
			description: "Відгул, що списується з робочого балансу",
			name: "Відгул",
		},
	},
	ru: {
		vacation: { name: "Отпуск", description: "Оплачиваемый отпуск" },
		sick: { name: "Больничный", description: "День болезни" },
		personal: {
			name: "По личным обстоятельствам",
			description: "Отпуск по личным обстоятельствам",
		},
		home_office: {
			name: "Удаленная работа",
			description: "День удалённой работы",
		},
		unpaid: {
			name: "Без сохранения зарплаты",
			description: "Неоплачиваемое отсутствие",
		},
		parental: {
			name: "Отпуск по уходу за ребенком",
			description: "Отсутствие в связи с отпуском по уходу за ребёнком",
		},
		bereavement: {
			name: "В связи с утратой",
			description: "Отпуск в связи со смертью близкого человека",
		},
		time_off_in_lieu: {
			description: "Отгул в счет рабочего баланса",
			name: "Отгул",
		},
	},
};

export function getBuiltInAbsenceCategoryTranslations(type: BuiltInAbsenceCategoryType) {
	return {
		nameTranslations: Object.fromEntries(
			Object.entries(builtInAbsenceCategoryTranslations).map(([locale, categories]) => [
				locale,
				categories[type].name,
			]),
		),
		descriptionTranslations: Object.fromEntries(
			Object.entries(builtInAbsenceCategoryTranslations).map(([locale, categories]) => [
				locale,
				categories[type].description,
			]),
		),
	};
}
