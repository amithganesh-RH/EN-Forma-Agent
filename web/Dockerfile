# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production --ignore-scripts && \
    npm ci --ignore-scripts

# ── Stage 2: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Placeholder env vars so build succeeds (real values injected at runtime)
ENV NEXTAUTH_SECRET=build-placeholder
ENV NEXTAUTH_URL=http://localhost:8080
ENV GOOGLE_CLIENT_ID=build-placeholder
ENV GOOGLE_CLIENT_SECRET=build-placeholder
ENV GOOGLE_REFRESH_TOKEN=build-placeholder
ENV GDRIVE_RAW_FOLDER_ID=build-placeholder
ENV GDRIVE_FORMA_FOLDER_ID=build-placeholder
ENV NEXT_PUBLIC_GDRIVE_RAW_FOLDER_ID=1L4qIfD4bha6oZpZTe7s5LbNcgRAgqLlL
ENV NEXT_PUBLIC_GDRIVE_FORMA_FOLDER_ID=1tUzez4CpPUV9oks8XUY-HzBen54Q0AYs

RUN npm run build

# ── Stage 3: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080

CMD ["node", "server.js"]
