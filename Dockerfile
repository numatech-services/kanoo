FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM base AS builder
RUN npm ci
COPY . .

# On définit des variables fictives pour que Next.js puisse compiler les routes API
# Ces valeurs seront écrasées par celles de ton docker-compose.yml au lancement
ENV MONGODB_URI="mongodb://localhost:27017/kanoo"
ENV NEXTAUTH_SECRET="build_only_secret"
ENV NEXTAUTH_URL="http://localhost:3000"

RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Sécurité : on ne lance pas le container en root
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# On récupère les fichiers du build standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Dans le mode standalone, Next.js génère un server.js
CMD ["node", "server.js"]