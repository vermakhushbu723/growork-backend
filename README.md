# Subkamyaab API (growork-backend)

One backend for both apps:

- **growork-user-app** — job seekers & freelancers (`app: "seeker"`)
- **growork-recruiter-app** — recruiters & freelance clients (`app: "recruiter"`)

A job posted in the recruiter app appears in the user app; an application or
proposal sent from the user app appears in the recruiter app; chat,
notifications and money (escrow → payout) flow between them.

Stack: Node 24 · TypeScript (tsx) · Express · Mongoose · Zod · JWT — same as
`candle-studio-backend`.

## Setup

```bash
npm install
cp .env.example .env     # then put your MongoDB URI + a JWT secret in .env
npm run seed             # small demo dataset (2–5 records per collection)
npm run dev              # http://localhost:5080/api/v1
npm run test:api         # in a 2nd terminal: checks every endpoint (88 checks)
```

`npm run seed` **wipes and re-creates** the `subkamyaab` database.
`npm run test:api` creates its own temporary accounts and deletes everything it
created at the end, so the seed data stays as it is.

> Port 5080, not 5060: 5060 is on the browser/fetch "blocked ports" list.

## Demo logins (password `Demo@123`)

| App | Email | Who |
|---|---|---|
| User | khushbu@demo.subkamyaab.com | Job seeker — applied to Flutter Developer, sent a proposal |
| User | priya@demo.subkamyaab.com | Freelancer — active contract, interview, proposals |
| User | rohit@demo.subkamyaab.com | Job seeker — shortlisted |
| Recruiter | ananya@demo.subkamyaab.com | Techify Solutions — jobs, applicants, projects, contract |
| Recruiter | rahul@demo.subkamyaab.com | StartupX — client with one project |

## Connecting the apps

Both apps default to the live API, `https://api.subkamyaab.achivora.com/api/v1`.
To point a build at a local backend instead:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:5080/api/v1        # emulator
flutter run --dart-define=API_BASE_URL=http://<your-PC-IP>:5080/api/v1    # real phone, same Wi-Fi
```

## Production

Live at `https://api.subkamyaab.achivora.com` (server `200.234.41.207`):

- Code in `/root/2ndProject/growork-backend`, `.env` there (mode 600, `NODE_ENV=production`,
  `OTP_DEV_MODE=false`).
- Runs under PM2 as `growork-api` on port 5080; nginx site
  `/etc/nginx/sites-available/api.subkamyaab.achivora.com` proxies to it, SSL by certbot.
- Uploaded files live in `/root/2ndProject/growork-uploads` (`UPLOAD_DIR`), outside the repo.
- Update: `cd /root/2ndProject/growork-backend && git pull && npm ci && pm2 restart growork-api`.
- Logs: `pm2 logs growork-api`.

## API overview (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` `/auth/login` `/auth/otp/send` `/auth/otp/verify` `/auth/reset-password` · `GET/PATCH/DELETE /auth/me` · `PATCH /auth/password` |
| Profile | `GET /profile/stats` · `POST/DELETE /profile/{documents,certificates,portfolio}` · `PATCH /profile/documents/:id/primary` · `GET/PATCH /settings` |
| Jobs (user app) | `GET /jobs` `/jobs/:id` · `POST /jobs/:id/apply` · `GET /applications/mine` · `DELETE /applications/:id` |
| Freelance (user app) | `GET /projects` `/projects/:id` · `POST /projects/:id/proposals` · `GET /proposals/mine` · `DELETE /proposals/:id` |
| Contracts (both) | `GET /contracts` `/contracts/:id` · `POST /contracts/:id/milestones/:i/{submit,fund,release,revision}` · `POST /contracts/:id/milestones` · `POST /contracts/:id/end` |
| Recruiter | `GET/POST/PATCH/DELETE /recruiter/jobs` (+ `/status`, `/duplicate`) · `GET/PATCH /recruiter/applicants` (+ `/offer`) · `GET/POST/PATCH /recruiter/interviews` · `GET /recruiter/analytics` |
| Client | `GET/POST/PATCH/DELETE /client/projects` (+ `/status`) · `GET/PATCH /client/proposals` · `POST /client/proposals/:id/hire` |
| Talent | `GET /talent` `/talent/:id` · `POST /talent/:id/invite` |
| Company | `GET/PATCH /company` · `POST/PATCH/DELETE /company/members` |
| Wallet | `GET /wallet` · `POST /wallet/add-money` `/wallet/withdraw` · `GET /plans` · `POST /wallet/plans/buy` |
| Chat | `GET /chats` `/chats/contacts` · `POST /chats/start` `/chats/read-all` · `GET/POST /chats/:id/messages` |
| Uploads | `POST /uploads` (multipart `file`, PDF/DOC/DOCX/JPG/PNG/WEBP, max 5 MB) → `{url,name,size}` · files served at `GET /files/:name` |
| Calls | `POST /calls` `{userId, video}` → LiveKit token · `GET /calls` `/calls/:id` · `POST /calls/:id/{accept,decline,end}` |
| Push | `POST /devices` `{token}` · `POST /devices/remove` |
| Payments | `GET /payments/config` · `POST /payments/order` `{amount}` · `POST /payments/verify` · `POST /payments/failed` · `POST /payments/webhook` (Razorpay) |
| Other | `GET /notifications` · `PATCH /notifications/read-all` `/notifications/:id/read` · `GET /saved` · `POST /saved/toggle` · `GET /reviews/me` |

## Live updates (Socket.IO)

Path `/api/v1/socket.io`, auth `{ token: <JWT> }`. Each signed-in app gets:
`notification` (every new notification — the apps refresh the matching
screen, e.g. a new applicant appears in the recruiter's job list at once),
`message` (`{conversationId, message}`), and `call:incoming` /
`call:accepted` / `call:declined` / `call:answered` / `call:ended`.
Every notification is also sent as a push notification once Firebase is set up.

## Turning on calls and push notifications

Both are built and wired end to end; they switch on when the keys are added.

**Voice / video calls (LiveKit)** — create a project at
[cloud.livekit.io](https://cloud.livekit.io) (free tier is fine), then in
the server's `.env`:

```
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

and `pm2 restart growork-api --update-env`. Until then `POST /calls` answers
503 "Calling isn't set up yet" and the apps show that message.

**Push notifications (Firebase Cloud Messaging)** — in one Firebase project:

1. Add two Android apps: `com.subkamyaab.app` (user app) and
   `com.subkamyaab.recruiter` (recruiter app). Download each
   `google-services.json` into that app's `android/app/` and rebuild the APK.
2. Project settings → Service accounts → *Generate new private key*. Copy the
   file to the server (e.g. `/root/2ndProject/firebase-service-account.json`)
   and set `FIREBASE_SERVICE_ACCOUNT=/root/2ndProject/firebase-service-account.json`
   in `.env`, then restart.

Incoming calls ring through a full-screen notification even when the app is
closed (needs push); while the app is open they arrive over the socket.

## Payments (Razorpay)

Add money goes through Razorpay Checkout: the app asks for an order
(`/payments/order`), the user pays by UPI / card / net banking, and the server
checks Razorpay's signature (`/payments/verify`) before crediting the wallet —
exactly once, even if the webhook also reports it. In production
`POST /wallet/add-money` (credit without paying) is switched off.

To turn it on, in the server's `.env`:

```
RAZORPAY_KEY_ID=rzp_live_...        # Dashboard → Account & Settings → API keys
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...         # Dashboard → Webhooks (see below)
```

Webhook: URL `https://api.subkamyaab.achivora.com/api/v1/payments/webhook`,
events `payment.captured`, `payment.failed`, `order.paid`. Then
`pm2 restart growork-api --update-env`. No app rebuild is needed — the apps
read the key from the server. Use `rzp_test_...` keys first to try it safely.

Withdrawals are recorded as requests; paying them out to bank accounts
(RazorpayX Payouts) isn't automated yet.

## Not built yet (needs an external service)

- **Payouts**: withdrawals are recorded, but the bank transfer is done manually.
- **OTP delivery**: codes aren't sent by SMS/email. `OTP_DEV_MODE=true` returns
  the code in the response (the apps show it); turn it off once SMS/email is wired.
- **Chat attachments**: resumes, documents and photos upload; files inside chat
  messages don't yet.
- **Google sign-in**: needs a Google OAuth client id.
