# Static host for the O'Neill scrape replica. public/ is pre-built locally by
# `node build.mjs` before `railway up`, so the image is just Caddy + files.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY public /srv/public
