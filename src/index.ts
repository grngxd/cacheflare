import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('*', cors())

async function proxyWithCache(c: any, targetUrl: string) {
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
      h.set('X-Cache', 'HIT')
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
  res.headers.set('X-Cache', 'MISS')

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

app.get('/:protocol/:host/*', async (c) => {
  const protocol = c.req.param('protocol')
  const host = c.req.param('host')

  if (protocol !== 'http' && protocol !== 'https') {
    return c.text('Invalid protocol. Use http or https.', 400)
  }

  const pathname = c.req.path
  const rest = pathname.split('/').slice(3).join('/')

  const qsIndex = c.req.url.indexOf('?')
  const query = qsIndex !== -1 ? c.req.url.slice(qsIndex) : ''
  const targetUrl = (rest ? `${protocol}://${host}/${rest}` : `${protocol}://${host}`) + query
  return proxyWithCache(c, targetUrl)
})

app.get('/:protocol/:host', async (c) => {
  const protocol = c.req.param('protocol')
  const host = c.req.param('host')
  if (protocol !== 'http' && protocol !== 'https') {
    return c.text('Invalid protocol. Use http or https.', 400)
  }
  const qsIndex = c.req.url.indexOf('?')
  const query = qsIndex !== -1 ? c.req.url.slice(qsIndex) : ''
  const targetUrl = `${protocol}://${host}` + query
  return proxyWithCache(c, targetUrl)
})

export default app
