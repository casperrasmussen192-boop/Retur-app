// api/_leverandorer.js
// Leverandørprofiler: hver leverandør har sit eget sæt læseregler.
// Tilføj en ny leverandør ved at tilføje en profil her + en linje i GENKENDELSE nedenfor.
// (Filer med _ foran er hjælpemoduler og bliver ikke til API-endpoints.)

export const PROFILER = {
  BD: {
    navn: "BD",
    system: "Du er en JSON-generator specialiseret i SAP-følgesedler og -fakturaer. Returner KUN rå JSON startende med { og sluttende med }. Inkluder alle ordrer. Afslut altid JSON korrekt.",
    // Uændret fra den oprindelige BD-prompt (på nær at sagsnummer-linjen er lagt i bygPrompt)
    regler: `Udtrækker ALLE varelinjer fra SAP-dokumentet.

VIGTIGT om dokumentnumre:
- Ordrenumre er 10-cifrede og starter med 101 (f.eks. 1010xxxxxx eller 1011xxxxxx). Læs dem fra "Ordrenr."-feltet.
- Kreditnotanumre starter med 300 og står ved "Kreditnota"-overskriften.
- IGNORER fakturanumre der starter med 111.
- IGNORER alle tal i bank-/IBAN-oplysninger nederst på siden — de er IKKE ordrenumre.

VIGTIGT om varelinjer:
- Medtag KUN varelinjer fra hoveddelen — IGNORER alt under "Leveres fra et andet lager".
- For kreditnotaer skal antal være negativt (f.eks. -3).
- Brug KUN den første linje af varebeskrivelsen som "navn" — kort og konsistent.
- Læg eventuelle ekstra beskrivelseslinjer i feltet "beskrivelse". Udelad SCIP-, EAN- og CAS-numre.

VIGTIGT om pos.nr:
- Pos.nr er et 3-cifret nummer (003, 006, 009...) i en separat "Pos" kolonne.
- Sæt "pos": null hvis kolonnen ikke er synlig — opfind ALDRIG et pos.nr.
- Fakturaer har INGEN pos-kolonne. Kun følgesedler har den.

Returner KUN JSON uden markdown:
{"ordrer":[{"ordrenr":"<101... eller 300...>","type":"<følgeseddel eller faktura eller kreditnota>","dato":"<dd-mm-yy>","linjer":[{"pos":null,"varenr":"<varenr>","navn":"<første linje>","beskrivelse":"<ekstra linjer eller tom>","antal":<tal>,"enhed":"<stk>"}]}]}`,
  },

  AO: {
    navn: "AO",
    system: "Du er en JSON-generator specialiseret i følgesedler og ordrebekræftelser fra AO / EA Værktøj. Returner KUN rå JSON startende med { og sluttende med }. Inkluder alle ordrer. Afslut altid JSON korrekt.",
    regler: `Udtrækker ALLE varelinjer fra dokumentet fra AO (EA Værktøj).

VIGTIGT om dokumenttype (stå i toppen af dokumentet):
- "Følgeseddel": type = "følgeseddel".
- "Ordrebekræftelse": type = "ordrebekræftelse".
- "Faktura": type = "faktura".
- "Kreditnota": type = "kreditnota".
- "Returkvittering": type = "returkvittering" (kvittering for varer der er returneret til AO).
Der er to layouts. FØLGESEDDEL, ORDREBEKRÆFTELSE og RETURKVITTERING har en grå boks øverst til venstre med "AO ordrenummer". FAKTURA og KREDITNOTA har en tabel øverst med kolonnerne Kunde, Projektnavn, Lever.dato, Antal lev., Ordrenr, Fakturadato og Side.

VIGTIGT om ordrenummer (altid 10 cifre, behold foranstillede nuller som tekst):
- Følgeseddel, ordrebekræftelse, returkvittering: feltet "AO ordrenummer" (f.eks. 1081946181 eller 0073949279).
- Faktura og kreditnota: feltet "Ordrenr" i tabellen øverst (f.eks. 1082386338 eller 0073947523).
- Ordrenumre starter typisk med 108 eller 007.
- IGNORER fakturanummeret/kreditnotanummeret der står som overskrift ved ordet FAKTURA/KREDITNOTA (8 cifre, f.eks. 23955796 eller 78654334) — det er IKKE ordrenummeret.
- IGNORER også "Leveringsnummer", "Fragtbrev nr.", "Reference", "Kundens ordre", kundenummer (2330521000), Projekt, Rute, Pakkenr/SSCC, Antal lev., CVR-, konto- og IBAN-numre.

VIGTIGT om varelinjer — FØLGESEDDEL:
- Kolonner: Linje, Emballage, Varenummer, Varenavn, Bestilt, Leveret, Tidl. Lev, Rest.
- "antal" er ALTID tallet under "Leveret" — IKKE "Bestilt". Er Leveret 0 eller tomt på en linje (varen er restordre), så udelad linjen.
- "pos" er tallet i kolonnen "Linje" (f.eks. "10").

VIGTIGT om varelinjer — ORDREBEKRÆFTELSE og RETURKVITTERING:
- Kolonner: Linje, Lager, Varenummer, Varenavn, Antal, Forv. Lev.
- "antal" er tallet i kolonnen "Antal" (ved ordrebekræftelse er det det bestilte). Ved returkvittering står antal allerede som negativt tal (f.eks. -15 MTR): behold det negative fortegn.
- "pos" er tallet i kolonnen "Linje".
- Lagerkoden (f.eks. 010 eller 370 i kolonnen Lager) er IKKE en del af varenummeret.

VIGTIGT om varelinjer — FAKTURA og KREDITNOTA:
- Kolonner: Stregkode, Beskrivelse/Varenr., VG, Antal/Enh, Pris/Afgift, Samlet pris, Varerab %, Nettobeløb.
- Hver vare fylder én linje: varebeskrivelsen står øverst (fed) og VARENUMMERET står lige under (f.eks. 186154032). "navn" = beskrivelsen, "varenr" = varenummeret under.
- "antal" er tallet i kolonnen "Antal"; enheden (STK, LGD osv.) står lige under tallet. På en kreditnota er antal negativt (f.eks. -1): behold fortegnet.
- Står den samme vare på flere linjer, så skal hver linje med som sin egen linje — læg dem IKKE sammen.
- "pos": null (disse dokumenter har ingen linjenummer).
- IGNORER stregkode, VG (varegruppe), Pris, Afgift, Samlet pris, Varerab %, Nettobeløb, Ordretotal, Moms og Total. Priser skal IKKE med.

VIGTIGT om alle dokumenttyper:
- "navn" er varenavnet præcis som det står (AO skriver ofte med store bogstaver og afkortet — behold det, men fjern overflødige mellemrum).
- IGNORER linjer med "EAN:" og "Pakkenr / SSCC:" — de må ikke ind i navn eller beskrivelse. Læg eventuelle andre ekstra tekstlinjer i "beskrivelse".
- IGNORER kolli, emballage, nettovægt, bruttovægt, volume og totaler — det er ikke varer.
- "enhed" er enheden efter antallet (STK, M, MTR, LGD, PK, SæT osv.) med små bogstaver, f.eks. "stk".
- For kreditnotaer og returkvitteringer skal antal være negativt. Faktura, følgeseddel og ordrebekræftelse har positivt antal.

VIGTIGT om dato:
- Følgeseddel: "Lev. Dato". Faktura/kreditnota: "Lever.dato". Ordrebekræftelse/returkvittering: "Ordredato" (eller "Forv. Lev.").
- Datoen står enten som seks cifre ddmmåå (f.eks. 260826 = 26-08-26, 081026 = 08-10-26, 121026 = 12-10-26) eller som dd/mm/åååå (f.eks. 13/10/2026). Skriv den altid som "dd-mm-yy" (f.eks. "26-08-26").

Returner KUN JSON uden markdown:
{"ordrer":[{"ordrenr":"<10 cifre>","type":"<følgeseddel eller ordrebekræftelse eller faktura eller kreditnota eller returkvittering>","dato":"<dd-mm-yy>","linjer":[{"pos":"<linje eller null>","varenr":"<varenr>","navn":"<varenavn>","beskrivelse":"<ekstra linjer eller tom>","antal":<tal>,"enhed":"<stk>"}]}]}`,
  },
};

export const GYLDIGE = Object.keys(PROFILER);

// Trin 1: billig genkendelse. Svaret skal være ét ord: BD, AO eller UKENDT.
export const GENKENDELSE = {
  system: "Du genkender hvilken leverandør et dansk handelsdokument stammer fra. Svar med PRÆCIS ét ord og intet andet.",
  prompt: `Hvilken leverandør har udstedt dette dokument (afsenderen — ikke kunden)?

- "BD": Brødrene Dahl (Brødrene Dahl A/S, "BD"). SAP-layout med følgeseddel, faktura eller kreditnota, "Ordrenr." 101..., fakturanr. 111..., kreditnota 300..., "Pos"-kolonne, evt. "Leveres fra et andet lager", og bank-/IBAN-oplysninger nederst.
- "AO": AO / EA Værktøj med logo "AO" / "EA VÆRKTØJ" (adresse Rørvang 3, Albertslund). Dokumenttyper: Følgeseddel, Ordrebekræftelse, Returkvittering (felt "AO ordrenummer" 108... eller 007...), samt Faktura og Kreditnota (tabel med "Ordrenr", "Lever.dato", "Rekvireret hos").
- "UKENDT": kun hvis dokumentet tydeligvis hverken er fra Brødrene Dahl eller AO.

Svar kun med ét af ordene: BD, AO eller UKENDT.`,
};

// Gør svaret fra genkendelsen til en profilnøgle, eller null hvis uklart
export function tolkGenkendelse(tekst) {
  const t = (tekst || "").toUpperCase();
  const fundet = GYLDIGE.filter(k => new RegExp(`\\b${k}\\b`).test(t));
  return fundet.length === 1 ? fundet[0] : null;
}

export function bygPrompt(profil, sagsnummer) {
  return `Sagsnummer: ${sagsnummer || "ukendt"}\n${profil.regler}`;
}
