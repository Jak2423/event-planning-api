# Nairly API

Standalone REST API backend for the [Nairly](https://nairly.mn) event-planning marketplace. Built with [Hono](https://hono.dev) + TypeScript, backed by Supabase (PostgreSQL).

## Ecosystem

```
event-planning/        → Next.js customer/provider frontend
event-planning-admin/  → Admin dashboard (separate project)
event-planning-api/    → This project — single API consumed by both frontends
```

## Stack

| Layer | Tech |
|---|---|
| Framework | [Hono](https://hono.dev) |
| Runtime | Node.js 20+ |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase JWT (Bearer token) |
| Validation | Zod + @hono/zod-validator |
| Dev | tsx watch |

## Getting started

```bash
cp .env.example .env
# Fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

npm install
npm run dev        # http://localhost:4000
```

## Environment variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (never expose to clients) |
| `PORT` | Port to listen on (default: 4000) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |

## API routes

### Public

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/venues` | List venues (filters: category, district, capacity, search, featured, page, limit) |
| GET | `/venues/:slug` | Single venue by slug |
| GET | `/venues/:id/availability?month=2026-05` | Time slots + confirmed bookings for a month |
| GET | `/time-slots/:venueId` | Weekly pricing config for a venue |

### Authenticated (Bearer token required)

| Method | Path | Description |
|---|---|---|
| GET | `/bookings` | Current user's bookings |
| GET | `/bookings/:id` | Single booking (owner or admin) |
| POST | `/bookings` | Create a booking (checks for date conflicts) |
| PATCH | `/bookings/:id/status` | Update status (customer: cancel only; provider/admin: any) |
| POST | `/venues` | Create a venue (provider+) |
| PATCH | `/venues/:id` | Update own venue (admin can update any) |
| PUT | `/time-slots/:venueId/:day` | Upsert day-of-week pricing (provider+) |
| DELETE | `/time-slots/:venueId/:day` | Remove day pricing override (provider+) |

### Admin only

| Method | Path | Description |
|---|---|---|
| GET | `/admin/orders` | All bookings with filters (status, venue, date range, pagination) |
| GET | `/admin/orders/stats` | Booking counts + total revenue |
| PATCH | `/admin/orders/:id` | Update any booking status |
| GET | `/admin/providers` | All providers with venue counts |
| GET | `/admin/providers/:id` | Provider detail with venues + recent bookings |
| PATCH | `/admin/providers/:id/verify` | Approve or revoke provider |
| PATCH | `/admin/providers/:id/role` | Change user role |

## Auth

Roles are stored in `app_metadata.role` in Supabase Auth:

- `customer` — browse and book
- `provider` — manage own venues/pricing (requires admin verification)  
- `admin` — full access

Every protected route expects:

```
Authorization: Bearer <supabase-access-token>
```

The token is obtained from Supabase Auth in the frontend (`supabase.auth.getSession()`).

## Frontend integration

In your Next.js `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Usage:

```typescript
const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/venues?category=restaurant`)
const { data, meta } = await res.json()
```

Authenticated:

```typescript
const { data: { session } } = await supabase.auth.getSession()

const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/bookings`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${session?.access_token}`,
  },
  body: JSON.stringify({ venue_id, booking_date, guest_count, total_price }),
})
```

## Project structure

```
src/
  index.ts                  ← Hono app, CORS, global error handler
  types/index.ts            ← AuthUser type, Hono context extension
  lib/
    supabase.ts             ← service-role + per-user scoped clients
  middleware/
    auth.ts                 ← authenticate · requireAdmin · requireProvider
  routes/
    venues.ts
    bookings.ts
    time-slots.ts
    admin/
      orders.ts
      providers.ts
```
