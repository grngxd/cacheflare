atiny Cloudflare Worker powered by Hono that proxies and caches HTTP(S) API responses.
basic proxy:
# cacheflare

a tiny cloudflare worker powered by hono that proxies and caches http(s) api responses.

- runtime: cloudflare workers + hono
- caching: cloudflare cache api (edge)
- cors: enabled (access-control-allow-origin: *)

## live endpoint

- base url: https://cacheflare.grng.workers.dev

if your workers.dev subdomain differs, replace the hostname accordingly.

## how does it work?

map a request path of the form:

- `/:protocol/:host/*`

to an external url:

- `https://cacheflare.grng.workers.dev/https/gettimeapi.dev/v1/time` -> `https://gettimeapi.dev/v1/time`

behavior:
- GET/HEAD are cached by default for a configurable ttl (default 300s)
- authorization header disables caching
- query string is part of the cache key (different queries → different cache entries)
- response header `x-cacheflare: HIT|MISS` indicates cache status

## quick start (local)

1) install deps & run

```pwsh
bun install
bun run dev
```

3) try it locally

- http://localhost:8787/https/gettimeapi.dev/v1/time

## deploy

1) log in once

```pwsh
bunx wrangler login
bun run deploy
```

wrangler prints your live url (e.g., `https://cacheflare.grng.workers.dev`).

## usage



- `GET https://cacheflare.grng.workers.dev/https/gettimeapi.dev/v1/time`

query param controls:

- `?ttl` — seconds to cache when the origin doesn’t specify (default 300, max 86400)
  - example: `...?ttl=60`
- `?respect=1` — respect origin cache-control; if missing, falls back to the ttl above
- `?no-cache=1` — bypass cache for this request

header control:

- `cf-cache-bypass: 1` — bypass cache (alternative to `no-cache=1`)

behavior notes:
- when not respecting origin (`respect` absent), `set-cookie` is stripped to keep responses cacheable
- authorization header present → response is not cached
- `x-cacheflare` header shows `hit` on cache hit and `miss` on fetch/store
- head requests are supported (no body)
