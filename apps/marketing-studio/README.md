# WiseCall Marketing Studio

Internal AI Marketing Command Centre for WiseCall and Owlnet.

## Purpose

- Phase 1: Brand Brain + content draft generation
- Separate Vercel project from `wisecall.io` and `app.wisecall.io`
- Uses existing WiseCall Supabase project
- AI routing via Vercel AI SDK + AI Gateway

## Routes

- `/` — workspace picker (WiseCall / Owlnet)
- `/login` — admin sign-in
- `/[brand]` — Brand Brain workspace
- `/[brand]/research` — Research Centre (Phase 2)
- `/[brand]/campaigns` — Campaign planner / calendar (Phase 2)
- `/[brand]/drafts` — Draft Studio
- `/[brand]/library` — Content Library

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3001

## Vercel deploy

```bash
vercel link
vercel env pull .env.local
vercel
vercel --prod
```

Project root for Vercel: `apps/marketing-studio`

Suggested domain: `studio.wisecall.io`
