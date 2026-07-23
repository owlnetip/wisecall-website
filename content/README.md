# content/

Private documents served behind a password by a serverless function. Nothing in
this folder is part of the public site: `vite.config.ts` excludes `content/` from
page discovery, so these files are never built into `dist/` or served statically.

## jameshare-blueprint.html

The AI strategy blueprint prepared for James Hare Limited, served at
`/jameshare` by `api/jameshare.js`.

To change the document, edit this file, then run:

```bash
npm run build:jameshare   # bundles it into lib/jameshare-blueprint.js
```

Commit both files. The bundle step also runs automatically as part of `prebuild`.

The access code is the `JAMESHARE_PASSWORD` environment variable on the
`wisecall-website` Vercel project. Changing it signs everyone out.
