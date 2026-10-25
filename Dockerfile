# syntax=docker/dockerfile:1
# From infra/templates/static-site.Dockerfile. Builds site/ against data/, then serves it with nginx on :8080, the
# port infra's sites.yml expects. The unprivileged image runs as a non-root user and listens on 8080 out of the box.
FROM node:24-alpine AS build
WORKDIR /src/site
# Dependencies first, so a data-only refresh reuses the npm ci layer.
COPY site/package.json site/package-lock.json ./
RUN npm ci
COPY data/ /src/data/
COPY site/ ./
ENV DATA_DIR=/src/data
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine
# Astro's 404 page for unknown paths; hashed assets under /_astro/ never change.
COPY <<'CONF' /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;
    error_page 404 /404.html;

    # HTML: Cloudflare caches it at the edge until the next deploy purges it; browsers revalidate each visit.
    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ =404;
    }
    location /_astro/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
CONF
COPY --from=build /src/site/dist /usr/share/nginx/html
EXPOSE 8080
