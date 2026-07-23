/** Local check of the /jameshare password gate. Run: node scripts/test-jameshare.mjs */
process.env.JAMESHARE_PASSWORD = 'silk-1865-leeds'
const { default: handler } = await import('../api/jameshare.js')

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
    status(c) { this.statusCode = c; return this },
    send(b) { this.body = b; return this },
  }
  return res
}
const call = async (req) => { const res = mockRes(); await handler(req, res); return res }
const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`)
}

// 1. anonymous GET gets the login screen, not the document
let r = await call({ method: 'GET', headers: {} })
check('anonymous GET is refused', r.statusCode === 401 && !r.body.includes('AI across your business'))
check('anonymous GET shows the login form', r.body.includes('name="password"'))
check('response is noindex', String(r.headers['x-robots-tag']).includes('noindex'))
check('response is not cached', String(r.headers['cache-control']).includes('no-store'))

// 2. wrong password is rejected
r = await call({ method: 'POST', headers: {}, body: { password: 'guess' } })
check('wrong password rejected', r.statusCode === 401 && !r.body.includes('AI across your business'))
check('wrong password explains itself', r.body.includes('not recognised'))

// 3. correct password returns the document and sets a cookie
r = await call({ method: 'POST', headers: {}, body: { password: 'silk-1865-leeds' } })
const setCookie = String(r.headers['set-cookie'])
check('correct password serves the document',
  r.statusCode === 200 && r.body.includes('AI across your business'))
check('document is the full 11 pages', (r.body.match(/class="page/g) || []).length === 11)
check('cookie is HttpOnly, Secure, scoped', /HttpOnly/.test(setCookie) &&
  /Secure/.test(setCookie) && /Path=\/jameshare/.test(setCookie))
check('cookie does not contain the password', !setCookie.includes('silk-1865-leeds'))

// 4. the cookie grants access on a later visit
const token = setCookie.match(/jh_access=([a-f0-9]+)/)[1]
r = await call({ method: 'GET', headers: { cookie: `other=1; jh_access=${token}` } })
check('valid cookie serves the document', r.statusCode === 200 && r.body.includes('Monday briefing'))

// 5. a forged cookie does not
r = await call({ method: 'GET', headers: { cookie: `jh_access=${'0'.repeat(64)}` } })
check('forged cookie refused', r.statusCode === 401 && !r.body.includes('AI across your business'))

// 6. urlencoded body (what the browser form actually sends)
r = await call({ method: 'POST', headers: {}, body: 'password=silk-1865-leeds' })
check('form-urlencoded body accepted', r.statusCode === 200 && r.body.includes('AI across your business'))

// 7. missing env var fails closed
delete process.env.JAMESHARE_PASSWORD
r = await call({ method: 'GET', headers: {} })
check('fails closed with no password set',
  r.statusCode === 503 && !r.body.includes('AI across your business'))

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
