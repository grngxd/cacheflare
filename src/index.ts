import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
const ver = "0.1.3"

app.use('*', cors())

const proxyWithCache = async (c: any, next?: any) => {
  const protocol = c.req.param('protocol')
  const host = c.req.param('host')

  if (protocol !== 'http' && protocol !== 'https') {
    return c.text('invalid protocol. Use "http" or "https"', 400)
  }

  const pathname = c.req.path
  const rest = pathname.split('/').slice(3).join('/')

  const qsIndex = c.req.url.indexOf('?')
  const query = qsIndex !== -1 ? c.req.url.slice(qsIndex) : ''
  const targetUrl = (rest ? `${protocol}://${host}/${rest}` : `${protocol}://${host}`) + query

  const method = c.req.method
  const hasAuth = !!c.req.header('authorization')
  const cache = (caches as unknown as { default: Cache }).default
  const cacheKey = new Request(c.req.url, { method: 'GET' }) // stable mapping
  const bypass = c.req.query('no-cache') === '1' || c.req.header('cf-cache-bypass') === '1'
  const respect = c.req.query('respect') === '1'
  const ttlParam = c.req.query('ttl')
  const ttl = Number.isFinite(Number(ttlParam)) && Number(ttlParam) >= 0 ? Math.min(86400, Number(ttlParam)) : 300

  if (!bypass && !hasAuth && (method === 'GET' || method === 'HEAD')) {
    const hit = await cache.match(cacheKey)
    if (hit) {
      const h = new Headers(hit.headers)
      h.set('X-Cacheflare', 'HIT')
      return new Response(method === 'HEAD' ? null : hit.body, {
        status: hit.status,
        statusText: hit.statusText,
        headers: h,
      })
    }
  }

  const fwdHeaders = new Headers()
  const copy = (name: string) => {
    const v = c.req.header(name)
    if (v) fwdHeaders.set(name, v)
  }
  copy('accept')
  copy('accept-language')
  copy('user-agent')
  if (hasAuth) copy('authorization')

  const originRes = await fetch(targetUrl, {
    method: method === 'HEAD' ? 'HEAD' : 'GET',
    headers: fwdHeaders,
    redirect: 'follow',
  })

  const headers = new Headers(originRes.headers)
  if (!respect) {
    headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`)
    headers.delete('Set-Cookie')
  } else if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`)
  }

  const res = new Response(method === 'HEAD' ? null : originRes.body, {
    status: originRes.status,
    statusText: originRes.statusText,
    headers,
  })
  res.headers.set('X-Cacheflare', 'MISS')

  if (!bypass && !hasAuth && (method === 'GET' || method === 'HEAD') && originRes.ok) {
    try {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()))
      } else {
        await cache.put(cacheKey, res.clone())
      }
    } catch (e) {
      console.error('cache error:', e)
    }
  }

  return res
}

app.get("/", async (c) => {
  const now = new Date().toISOString()
  
  return c.html(`
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>cacheflare v${ver}</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 2em; background: #fafbfc; color: #222; }
          code, pre { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
          h1 { font-size: 2em; margin-bottom: 0.2em; }
          .ver { color: #888; font-size: 0.9em; }
          .section { margin-bottom: 1.5em; }
        </style>
      </head>
      <body>
        <h1>cacheflare <span class="ver">v${ver}</span></h1>
        <div class="section">
          <b>a tiny cloudflare worker that proxies and caches http(s) api responses.</b><br>
          <span style="color:#888">powered by hono, deployed on cloudflare edge</span>
        </div>
        <div class="section">
          <b>live endpoint:</b><br>
          <code>${c.req.url}</code>
        </div>
        <div class="section">
          <b>usage:</b><br>
          <code>${c.req.url}https/gettimeapi.dev/v1/time</code> proxies to <code>https://gettimeapi.dev/v1/time</code> & caches for 5 minutes<br>
          try it out!
          <br>
          <br>

          <b>query params:</b>
          <ul>
            <li><code>ttl</code>: cache seconds (default 300, max 86400)</li>
            <li><code>respect=1</code>: respect origin cache-control</li>
            <li><code>no-cache=1</code>: bypass cache</li>
          </ul>
          <b>headers:</b>
          <ul>
            <li><code>cf-cache-bypass: 1</code>: bypass cache</li>
          </ul>
          <b>response header:</b>
          <ul>
            <li><code>x-cacheflare: hit|miss</code> (shows cache status)</li>
          </ul>
        </div>
        <div class="section">
          <b>example:</b><br>
          <code><a href="/https/gettimeapi.dev/v1/time" target="_blank">/https/gettimeapi.dev/v1/time</a></code>
        </div>
        <div class="section" style="color:#888">
          <b>current time:</b> ${now}
        </div>
        <div class="section" style="color:#bbb;font-size:0.9em;">
          <b>source:</b> <a href="https://github.com/grngxd/cacheflare" target="_blank">github.com/grngxd/cacheflare</a>
        </div>
      </body>
    </html>
  `)
})

app.use('/:protocol/:host/*', proxyWithCache)
app.use('/:protocol/:host', proxyWithCache)

export default app
