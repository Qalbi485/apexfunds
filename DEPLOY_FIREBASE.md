# Firebase App Hosting — Deploy Guide (Roman Urdu)

Sab kuch code side ready hai. Sirf ye steps karo — **Qalbi Studio Gmail** se login.

## 1) Neon Postgres (free)
1. https://neon.tech → signup (Qalbi Studio Gmail)
2. **Create project** → region apne qareeb (e.g. AWS ap-southeast-1)
3. **Connection string** copy karo (psql) → aakhir me `?sslmode=require` laga do.
   Misal: `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`

## 2) GitHub repo + push
```powershell
# web folder ke andar (C:\Users\Qalbi\Desktop\Funded firm\web)
git remote add origin https://github.com/<YOUR-USER>/<REPO>.git
git branch -M main
git push -u origin main
```
Agar GitHub par repo khali banaya (README ke baghair) to ye seedha chalega.

## 3) Firebase project
1. https://console.firebase.google.com → **Add project** → naam: `apexfunds`
2. Project ke andar **Upgrade → Blaze** (card, free quota me bill ~$0)

## 4) App Hosting connect
1. Console → **Build → App Hosting → Get started**
2. GitHub connect → repo + branch `main`
3. **Root directory: `web`**
4. Build command (App Hosting "Build settings" ya `apphosting.yaml`):
   `node scripts/prepare-pg-schema.mjs && npx prisma generate --schema prisma/schema.postgres.prisma && npm run build`
5. **Environment variables / Secrets** add karo (values khud generate karo, neeche commands):

```powershell
# random secrets (PowerShell)
-join ((1..64) | % { '{0:x}' -f (Get-Random -Maximum 16) })   # SESSION_SECRET
-join ((1..64) | % { '{0:x}' -f (Get-Random -Maximum 16) })   # CRON_SECRET
-join ((1..64) | % { '{0:x}' -f (Get-Random -Maximum 16) })   # PRICE_SALT
```

Secrets: `DATABASE_URL` (Neon), `SESSION_SECRET`, `CRON_SECRET`, `PRICE_SALT`.

## 5) Database create (ek dafa)
Local terminal me Neon string ke saath:
```powershell
$env:DATABASE_URL="postgresql://...neon...?sslmode=require"
node scripts/prepare-pg-schema.mjs
npx prisma db push --schema prisma/schema.postgres.prisma
npx tsx scripts/create-admin.ts   # admin account
```

## 6) Cron (settlement + price feed)
Cloud Console → **Cloud Scheduler** → Create job:
- Frequency: `* * * * *`
- URL: `https://<apphosting-url>/api/cron/sync`
- HTTP GET, header: `Authorization: Bearer <CRON_SECRET>`

## 7) Launch se pehle
- Demo accounts delete: `npx tsx scripts/demo-seed.ts --clean` (ya DB me manually)
- SMTP env set karo (email ke liye)
- Custom domain lagana ho to App Hosting → Domains

## Local dev (waise hi chalta rahega)
SQLite + tests: `npm test` (218/0), servers: 3000 (dev) / 3100 (staging).
