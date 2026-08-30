# CNC Research Console

Next.js frontend for the authenticated research workspace.

## Run

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

`NEXT_PUBLIC_API_BASE_URL` must point to the platform backend. The current UI contains the research overview, sign-in flow, and administrator-only user management.

## Verify

```bash
npm run build
```
