# Lernapp auf Fly.io: statische PWA, ausgeliefert von nginx. Kein Server-Code —
# alle Daten bleiben im Browser (IndexedDB).
FROM node:22-slim AS bau
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=bau /app/dist/lernapp/browser /usr/share/nginx/html
EXPOSE 8080
