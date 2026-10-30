# Mivora

Mivora is a beauty services discovery and booking mobile app. Customers find salons and independent specialists, book appointments, and manage visits. Business owners create a public profile, publish services and hours, and handle incoming bookings.

The project is a working Expo application with a Supabase backend. It is **not** listed on the App Store or Google Play.

## Key features

### Implemented — customers

- Email sign-up and sign-in with Supabase Auth
- Home catalog of published providers, scoped to Bangkok or Phuket
- Category browsing (nails, hair, lashes, brows, makeup, massage, facial, waxing, and other)
- Search with filters for category, area, salon vs specialist, and maximum price
- List and map views of search results, plus optional “near me” straight-line distance (one-time location permission)
- Provider profiles with services, portfolio, reviews, and directions
- Favorites
- Booking with service selection, Asia/Bangkok dates, and available time slots
- Booking lifecycle: pending, confirmed, reschedule, cancel, and past visits
- Reviews after eligible bookings
- Profile editing
- In-app notifications
- Optional local appointment reminders on the device

### Implemented — business owners

- Business onboarding checklist (profile, at least one service, working hours, then publish)
- Edit name, bio, cover photo, city, area, and map pin
- Manage services, weekday hours, date exceptions, and portfolio photos
- Manual publish and unpublish (the app never auto-unpublishes)
- Incoming booking list with owner actions (confirm, decline, and related management)

### Implemented — backend (this repository)

- Supabase Postgres schema and migrations, including RLS and booking RPCs
- Catalog, bookings, favorites, reviews, notifications, and provider-management data access from the app via the **anon** key only
- Cover and portfolio image uploads through Supabase Storage
- `deliver-booking-push` Edge Function for Expo push outbox work
  - `dry_run` is read-only
  - live send and receipt processing are **off unless** `PUSH_LIVE_DELIVERY_ENABLED` or `PUSH_RECEIPTS_ENABLED` is exactly `true`
  - live paths still require `PUSH_DELIVERY_SECRET`; they do not accept a user JWT as that secret

### Not implemented (planned)

- App Store or Google Play listing
- In-app payments or deposits
- Customer–business chat
- Enabling live Expo push or receipt processing by default
- A public web booking site or admin dashboard
- Additional cities beyond Bangkok and Phuket in the client city picker

## Tech stack

| Layer | Choice |
| --- | --- |
| App | React Native, React 19, Expo SDK 58 |
| Navigation | Expo Router (file-based routes in `src/app/`) |
| Language | TypeScript (strict) |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions) |
| Maps / location | `react-native-maps`, `expo-location` |
| Notifications | `expo-notifications` (local reminders in the app; remote push worker in `supabase/functions`) |
| Builds | EAS (`eas.json`) |
| Unit tests | Node.js test runner (`npm test`) |

## App architecture

```
src/app/                 Expo Router screens
src/components/          Shared UI
src/context/             Auth, city, favorites, bookings, notifications, reminders, push token
src/data/repositories/   Supabase access used by screens
src/lib/                 Domain helpers (availability, search, booking rules, dates)
src/constants/           Theme, cities, category icons
supabase/migrations/     Database schema, RLS, and RPCs (apply in timestamp order)
supabase/functions/      deliver-booking-push Edge Function
supabase/verify/         Read-only SQL checks for selected migrations
supabase/config.toml     Function settings (verify_jwt for deliver-booking-push only)
```

The app talks to Supabase with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Privileged work (claiming the push outbox, completing deliveries) stays on the server behind service-role RPCs and the Edge Function secret. The mobile client does not embed a service-role key.

Time for bookings and working hours is treated as **Asia/Bangkok**.

### Supabase folders

- **`supabase/migrations/`** — ordered SQL that defines tables, RLS, and RPCs. Apply these against your own project; this repo does not ship a live database.
- **`supabase/functions/`** — `deliver-booking-push`, the authenticated worker for dry-run, optional live Expo send, and optional receipt processing.
- **`supabase/verify/`** — optional verification scripts used to inspect privileges and invariants after a migration. They are not a substitute for applying migrations.

`supabase/.temp/` is CLI link cache and must not be committed.

## EAS configuration

[`eas.json`](eas.json) defines Expo Application Services profiles: `development` (dev client, internal), `preview` (internal), and `production` (auto-increment). `app.json` includes the Expo account `owner` and `extra.eas.projectId` used by EAS builds.

This file does **not** mean the app is submitted to the App Store or Google Play. Cloud builds and store submit are optional later steps (`eas build`, `eas submit`).

## Screenshots

Product screenshots are not in this repository yet. When added, place PNG files under `docs/screenshots/` (for example `home.png`, `search.png`, `provider.png`, `booking.png`, `business.png`).

## Installation and local development

**Requirements:** Node.js 20+, npm, and [Expo Go](https://expo.dev/go) or an iOS Simulator / Android emulator.

```bash
git clone <your-fork-url>
cd mivora
cp .env.example .env
# Edit .env with your Supabase project URL and anon key
npm install
npx expo start
```

Then open the project in Expo Go or a simulator.

Useful commands:

```bash
npx tsc --noEmit   # typecheck
npm test           # unit tests (src/lib and the push worker)
npx expo start     # Metro bundler
```

Do not commit `.env`. Do not put service-role keys in Expo environment variables.

Some native modules (maps, notifications, location) need a development build for full behavior; Expo Go covers a large part of the UI but not every native path.

## Environment variables

**Expo app** (`.env`, names only):

| Name | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase API URL for the client |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (RLS still applies) |

**Edge Function secrets** (Supabase Dashboard → Edge Functions → Secrets, not the mobile `.env`):

| Name | Purpose |
| --- | --- |
| `PUSH_DELIVERY_SECRET` | Shared secret to invoke `deliver-booking-push` |
| `PUSH_LIVE_DELIVERY_ENABLED` | Must be the string `true` to send Expo tickets; omit or any other value keeps live send off |
| `PUSH_RECEIPTS_ENABLED` | Must be the string `true` to process Expo receipts; omit or any other value keeps receipts off |
| `EXPO_ACCESS_TOKEN` | Optional Expo Push access token |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Provided automatically on hosted functions |

## Supabase setup requirements

1. Create your own Supabase project.
2. Apply the SQL files in `supabase/migrations/` in timestamp order (or with the Supabase CLI against **your** project).
3. Configure Auth (email) for local sign-up and sign-in.
4. Copy the project URL and **anon** key into `.env`. Never use the service-role key in the app.
5. Deploy `deliver-booking-push` only if you need the worker. Leave live and receipts flags unset until you intend to send push.
6. `supabase/config.toml` sets `verify_jwt = false` only for this function; the handler still requires `PUSH_DELIVERY_SECRET`.

This repository does not include production credentials, customer rows, or a live project link.

## Current project status

- Mobile product flows above are implemented in this codebase.
- Automated tests cover booking helpers, search, availability, business rules, and the push worker.
- The app is suitable as a portfolio and local development project.
- It is **not** a published store app and should not be described as live on the App Store or Google Play.

## Future improvements

- Store listing and production release engineering (EAS submit, privacy questionnaires, store assets)
- Payments
- Turning on remote push only after a dedicated operations review
- Broader city coverage and richer search ranking
- Customer–provider messaging

## License

MIT. See [`LICENSE`](LICENSE). Original Mivora code is copyright Anna Sytenko (2026). The repository still includes portions of the Expo project template, which remain copyright 650 Industries, Inc. (aka Expo).
