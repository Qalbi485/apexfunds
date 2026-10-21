# Funded Firm — Deploy (VPS, 5 minute setup)

## Requirements
- VPS: 2 vCPU, 2 GB RAM, 40 GB SSD (Ubuntu 22.04/24.04)
- Domain pointed to VPS IP (A record)

## Steps (on VPS)

```bash
# 1. Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx

# 2. Upload project (from your PC, in web/ folder)
#    Use git push to GitHub, then on VPS:
git clone <your-repo> /var/www/fundedfirm
cd /var/www/fundedfirm/web

# 3. Env setup
cp .env.example .env
nano .env        # fill DATABASE_URL, SESSION_SECRET, addresses, SMTP, telegram, CRON_SECRET
# DATABASE_URL="file:/var/www/fundedfirm/web/prisma/prod.db"
# SESSION_SECRET:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# CRON_SECRET:     node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
# NEVER commit .env or the *.db files.

# 4. Install + build + seed
npm ci
npm run db:push        # takes a pre-push backup first; auto-restores on failure
npm run db:seed        # skips seed/demo accounts automatically in production
npm run build

# 4b. Create the first admin (production-safe; no demo password needed)
ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='a-strong-passphrase' npm run db:create-admin

# 5. PM2 (keeps app alive)
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # follow the printed command

# 6. Nginx
sudo cp nginx.conf /etc/nginx/sites-available/fundedfirm
# edit: server_name yourdomain.com
sudo ln -s /etc/nginx/sites-available/fundedfirm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 7. SSL
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# 8. Cron: auto-sync trades every 5 minutes
crontab -e
# add this line (replace secret):
# */5 * * * * curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" https://yourdomain.com/api/cron/sync > /dev/null
```

## Production security checklist
- [ ] `SESSION_SECRET` = fresh 64-hex (rotate = all sessions invalidate; users re-login)
- [ ] `CRON_SECRET` = fresh random value (rotate freely; update crontab)
- [ ] `NODE_ENV=production` (implies: seed/demo logins blocked unless
      `ALLOW_SEED_LOGIN=true`, secure cookies, HSTS header). Do **not** set
      `ALLOW_SEED_LOGIN=true` on a real deployment.
- [ ] Seed/demo accounts disabled: login with `admin@apexfunds.com` /
      `demo@...` / `trader1@...` must fail (check logs for `seed_login_blocked`)
- [ ] First admin created via `npm run db:create-admin` (never via the seed
      demo password)
- [ ] SMTP configured and a password-reset email actually delivered (end-to-end)
- [ ] Telegram alert configured (optional but recommended)
- [ ] HTTPS enforced (certbot) — cookies are `Secure` in production
- [ ] nginx forwards `X-Forwarded-For` (app trusts the RIGHTMOST hop; keep
      `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
- [ ] App binds loopback only (`npm start` runs `next start -H 127.0.0.1`) —
      anyone who could reach :3000 directly could spoof XFF; only nginx
      (localhost) may talk to the app. For a LAN demo use nginx, not a
      wildcard bind. If you must widen it: `next start -H <lan-ip>`.
- [ ] Health check wired: `curl https://yourdomain.com/api/health` → `{"ok":true}`
- [ ] `curl -I https://yourdomain.com` shows X-Frame-Options / X-Content-Type-Options / HSTS
- [ ] Admin 2FA enrolled (Admin → Security) and `adminTwoFactor` setting on
- [ ] Audit log (Admin → Audit) shows PAYMENT_CONFIRMED / PAYOUT_PAID rows with actor
- [ ] DB backups scheduled (below) and **restore tested once**

## Known ceiling: SQLite write concurrency
`db push`-on-SQLite is fine for a single instance (`instances: 1` in
ecosystem.config.js), but SQLite has one writer: a burst of simultaneous
financial transactions queues, and under a heavy burst Prisma can return a
P1008 socket-timeout. All financial paths are written **fail-closed** — a
timed-out transaction rolls back (no partial state, no over-issuance); the
worst case is a user-visible error they can retry. Before scaling past one
instance (or a real payout/traffic surge) move `DATABASE_URL` to PostgreSQL
(only connection-string change + `prisma db push`).

## Backups & restore
```bash
# Consistent snapshot (safe while app is running):
npm run db:backup                 # → prisma/backups/apex-<ts>.db

# Scheduled (daily):
# 0 3 * * * cd /var/www/fundedfirm/web && npm run db:backup >> /var/www/fundedfirm/web/prisma/backups/backup.log 2>&1

# Restore (STOP the app first):
pm2 stop all
npx tsx scripts/restore-db.ts prisma/backups/apex-<ts>.db --yes
pm2 start all
```
The restore verifies `PRAGMA integrity_check` before AND after copying, and
keeps the previous database at `<target>.pre-restore`.

## Migration / rollback plan
1. `npm run db:push` first makes `prisma/backups/prepush-<ts>.db`.
2. Push fails → the previous database is restored automatically; the broken
   file is kept at `<db>.failed-<ts>` for inspection.
3. App-code rollback (bad release): `git checkout <last-good> && npm ci && npm run build && pm2 restart all`.
4. Schema rollback: restore the newest `prepush-*` backup with
   `restore-db.ts --yes` **and** redeploy the matching older app version —
   Prisma `db push` has no down-migration; the pre-push backup IS the
   rollback. Never run a push from a newer schema against an older app.
5. Secret rotation: `SESSION_SECRET` → all sessions invalidate (safe, users
   re-login). `CRON_SECRET` → update the crontab line.

## Post-launch checklist
- [ ] Log in as the admin created in step 4b → Settings → change the password
- [ ] Settings → real USDT TRC20/ERC20 addresses
- [ ] Test full flow: register → buy → TXID → confirm → sync
- [ ] SMTP/Telegram alerts working
- [ ] First backup taken and **restore verified on a scratch copy**:
      `npm run db:backup && npx tsx scripts/restore-db.ts <backup> --yes --target /tmp/restore-test.db`
