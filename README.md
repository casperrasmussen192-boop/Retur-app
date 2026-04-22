# BD Retur-assistent — Opsætningsvejledning

## Hvad er dette?
En SaaS-applikation der hjælper BD-medarbejdere med at håndtere materialeretur.
Brugere logger ind, uploader SAP-følgesedler og får automatisk en samlet returliste.

## Mappestruktur
```
bd-retur-app/
├── api/
│   ├── _auth.js          # JWT-hjælper (deles af alle routes)
│   ├── analyse.js        # Modtager PDF'er → kalder Anthropic → returnerer data
│   ├── chat.js           # AI-chat om en sag
│   ├── login.js          # Bruger logger ind
│   ├── register.js       # Bruger opretter konto
│   └── stripe-webhook.js # Stripe kalder denne ved betaling
├── public/
│   └── index.html        # Hele frontend-appen
├── .env.example          # Skabelon til miljøvariabler
├── package.json
└── vercel.json
```

---

## Trin 1 — GitHub

1. Opret en gratis konto på **github.com**
2. Klik "New repository" → navngiv det `bd-retur-app` → "Create"
3. Upload alle filer fra denne mappe til repositoriet

---

## Trin 2 — Vercel (hosting, gratis)

1. Gå til **vercel.com** og log ind med GitHub
2. Klik "Add New Project" → vælg dit `bd-retur-app` repository
3. Klik "Deploy" — Vercel bygger appen automatisk

### Tilføj Vercel KV (database til brugere)
1. Gå til dit projekt på Vercel → "Storage" → "Create Database" → "KV"
2. Vælg gratis plan → "Create"
3. Vercel tilføjer automatisk KV_URL og de andre variabler

---

## Trin 3 — Miljøvariabler på Vercel

Gå til dit projekt → "Settings" → "Environment Variables" og tilføj:

| Navn | Værdi | Hvor finder du den |
|------|-------|-------------------|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | console.anthropic.com → API Keys |
| `JWT_SECRET` | Lang tilfældig streng | Kør: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `STRIPE_SECRET_KEY` | `sk_live_...` | dashboard.stripe.com → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe → Webhooks (se Trin 4) |

---

## Trin 4 — Stripe (betaling)

1. Opret konto på **stripe.com**
2. Gå til "Products" → "Add product"
   - Navn: "BD Retur-assistent Pro"
   - Pris: f.eks. 199 kr/måned (recurring)
   - Kopiér **Price ID** (`price_...`) — gem det
3. Gå til "Developers" → "Webhooks" → "Add endpoint"
   - URL: `https://dit-domæne.vercel.app/api/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.deleted`
   - Kopiér **Webhook Secret** (`whsec_...`) og tilføj til Vercel

---

## Trin 5 — Eget domæne (valgfrit)

1. Køb domæne hos Simply.com eller One.com (~100 kr/år)
2. Gå til Vercel → "Domains" → tilføj dit domæne
3. Følg Vercels vejledning til DNS-opsætning (tager 5 min)

---

## Prissætning — forslag

| Plan | Pris | Indhold |
|------|------|---------|
| Trial | Gratis | 5 analyser |
| Pro | 199 kr/md | Ubegrænset analyser, 1 bruger |
| Team | 499 kr/md | Ubegrænset, op til 5 brugere |

---

## Hvad koster det dig at drive?

- **Vercel hosting**: Gratis (op til 100 GB båndbredde/måned)
- **Vercel KV**: Gratis (op til 30.000 requests/dag)
- **Anthropic**: ~0,003 kr pr. analyse
- **Stripe**: 1,4% + 1,80 kr pr. transaktion

En Pro-kunde til 199 kr/md koster dig ca. 3 kr/md i API-udgifter.
