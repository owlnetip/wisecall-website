/**
 * Password gate for the James Hare AI strategy blueprint at /jameshare.
 *
 * The document is bundled into the function (lib/jameshare-blueprint.js) rather
 * than served from public/, so it is never reachable without the password.
 *
 * Required environment variable: JAMESHARE_PASSWORD
 */
import crypto from 'node:crypto'
import { BLUEPRINT_HTML } from '../lib/jameshare-blueprint.js'

const COOKIE = 'jh_access'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days
const TOKEN_SEED = 'jameshare-blueprint-v1'

const tokenFor = (password) =>
  crypto.createHmac('sha256', password).update(TOKEN_SEED).digest('hex')

function sameString(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    return Object.fromEntries(new URLSearchParams(req.body))
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
}

const shell = (inner) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>James Hare Blueprint &middot; WiseCall</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 28px; background: #0A1F1E; color: #EAF4F2;
    background-image: radial-gradient(120% 90% at 78% 6%, rgba(45,212,191,.12), transparent 60%);
    font-family: "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    -webkit-font-smoothing: antialiased; }
  .box { width: 100%; max-width: 400px; }
  .logo { font-weight: 800; font-size: 17px; letter-spacing: .17em; margin-bottom: 40px; }
  .logo .c { color: #2DD4BF; }
  .eyebrow { font-size: 10.5px; letter-spacing: .21em; text-transform: uppercase;
    color: #2DD4BF; font-weight: 700; margin: 0 0 12px; }
  h1 { font-size: 27px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15;
    margin: 0 0 12px; }
  p { color: rgba(234,244,242,.68); font-size: 14.5px; line-height: 1.6; margin: 0 0 26px; }
  label { display: block; font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase;
    color: rgba(234,244,242,.55); font-weight: 700; margin-bottom: 8px; }
  input { width: 100%; padding: 13px 15px; font-size: 15px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06);
    color: #FFFFFF; font-family: inherit; }
  input:focus { outline: 2px solid #2DD4BF; outline-offset: 1px;
    border-color: transparent; background: rgba(255,255,255,.09); }
  button { width: 100%; margin-top: 14px; padding: 13px 15px; font-size: 14.5px;
    font-weight: 750; border: 0; border-radius: 8px; background: #2DD4BF; color: #06201D;
    cursor: pointer; font-family: inherit; letter-spacing: .01em; }
  button:hover { background: #5EEAD4; }
  button:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
  .err { border-left: 2px solid #F98F7E; background: rgba(249,143,126,.1);
    color: #F9C3B9; padding: 10px 14px; border-radius: 0 6px 6px 0; font-size: 13.5px;
    margin: 0 0 20px; }
  .foot { margin-top: 34px; font-size: 10px; letter-spacing: .16em; text-transform: uppercase;
    color: rgba(234,244,242,.35); }
</style>
</head>
<body>
  <div class="box">
    <div class="logo">WISE<span class="c">CALL</span></div>
    ${inner}
    <div class="foot">Confidential &middot; Owlnet IP Ltd</div>
  </div>
</body>
</html>`

const loginPage = (error) => shell(`
    <p class="eyebrow">Private document</p>
    <h1>AI Strategy Blueprint</h1>
    <p>Prepared for James Hare Limited. Enter the access code you were given to view it.</p>
    ${error ? `<p class="err">${error}</p>` : ''}
    <form method="POST" action="/jameshare">
      <label for="password">Access code</label>
      <input id="password" name="password" type="password" autocomplete="current-password"
        autofocus required>
      <button type="submit">View document</button>
    </form>`)

const notConfigured = () => shell(`
    <p class="eyebrow">Unavailable</p>
    <h1>Not configured</h1>
    <p>This document is not available yet. Please contact Owlnet IP Ltd.</p>`)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  const password = process.env.JAMESHARE_PASSWORD
  if (!password) return res.status(503).send(notConfigured())

  const expected = tokenFor(password)

  if (req.method === 'POST') {
    const body = await readBody(req)
    const supplied = (body.password || '').trim()
    if (supplied && sameString(supplied, password)) {
      res.setHeader('Set-Cookie', [
        `${COOKIE}=${expected}; Path=/jameshare; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      ])
      return res.status(200).send(BLUEPRINT_HTML)
    }
    // Small delay to take the edge off automated guessing.
    await new Promise((r) => setTimeout(r, 700))
    return res.status(401).send(loginPage('That access code was not recognised. Please try again.'))
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, POST')
    return res.status(405).send(loginPage())
  }

  const cookie = readCookie(req, COOKIE)
  if (cookie && sameString(cookie, expected)) {
    return res.status(200).send(BLUEPRINT_HTML)
  }

  return res.status(401).send(loginPage())
}
