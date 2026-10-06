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

VIGTIGT om dokumenttype:
- Står der "Følgeseddel" i toppen: type = "følgeseddel".
- Står der "Ordrebekræftelse" i toppen: type = "ordrebekræftelse".
- Står der "Faktura": type = "faktura". Står der "Kreditnota": type = "kreditnota".

VIGTIGT om dokumentnumre:
- Ordrenummeret står i feltet "AO ordrenummer" og er 10-cifret og starter typisk med 108 (f.eks. 1081946181).
- IGNORER "Leveringsnummer", "Fragtbrev nr.", "Reference", kundenummer, Rute, Pakkenr/SSCC og alle andre tal i headeren — de er IKKE ordrenummeret.

VIGTIGT om varelinjer:
- Kolonner: Linje, Emballage, Varenummer, Varenavn, Bestilt, Leveret, Tidl. Lev, Rest.
- "antal" er ALTID tallet under "Leveret" — IKKE "Bestilt". Er Leveret 0 eller tomt på en linje (varen er restordre), så udelad linjen.
- På en ordrebekræftelse findes der ingen leverede mængder: brug "Bestilt" som antal.
- "pos" er tallet i kolonnen "Linje" (f.eks. "10"), ellers null.
- "varenr" er varenummeret (f.eks. 853006462). Lagerkoden ("010" fra "Lager 010 - AO centrallager") er IKKE en del af varenummeret.
- "navn" er varenavnet præcis som det står (AO skriver ofte med store bogstaver og afkortet — behold det, men fjern overflødige mellemrum).
- IGNORER linjer med "EAN:" og "Pakkenr / SSCC:" — de må ikke ind i navn eller beskrivelse. Læg eventuelle andre ekstra tekstlinjer i "beskrivelse".
- IGNORER kolli, emballage, nettovægt, bruttovægt, volume og totaler — det er ikke varer.
- "enhed" er enheden efter antallet (STK, M, PK, SæT osv.) med små bogstaver, f.eks. "stk".
- For kreditnotaer skal antal være negativt.

VIGTIGT om dato:
- Brug "Lev. Dato" (følgeseddel) eller dokumentets dato (ordrebekræftelse).
- Datoen står enten som seks cifre (ddmmåå, f.eks. 260826 = 26-08-26) eller som dd/mm/åååå. Skriv den altid som "dd-mm-yy" (f.eks. "26-08-26").

Returner KUN JSON uden markdown:
{"ordrer":[{"ordrenr":"<108...>","type":"<følgeseddel eller ordrebekræftelse eller faktura eller kreditnota>","dato":"<dd-mm-yy>","linjer":[{"pos":"<linje eller null>","varenr":"<varenr>","navn":"<varenavn>","beskrivelse":"<ekstra linjer eller tom>","antal":<tal>,"enhed":"<stk>"}]}]}`,
  },
};

export const GYLDIGE = Object.keys(PROFILER);

// Trin 1: billig genkendelse. Svaret skal være ét ord: BD, AO eller UKENDT.
export const GENKENDELSE = {
  system: "Du genkender hvilken leverandør et dansk handelsdokument stammer fra. Svar med PRÆCIS ét ord og intet andet.",
  prompt: `Hvilken leverandør har udstedt dette dokument (afsenderen — ikke kunden)?

- "BD": Bygma/BD Byggedepot eller andet SAP-layout med "Ordrenr." 101..., "Leveres fra et andet lager", og kreditnotaer 300...
- "AO": AO / EA Værktøj med logo "AO EA VÆRKTØJ", "AO ordrenummer" 108..., "Bestilt hos", "Leveringsnummer" og "Fragtbrev nr.".
- "UKENDT": alt andet, eller hvis du er det mindste i tvivl.

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
