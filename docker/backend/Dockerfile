FROM node:22-alpine AS pruner
RUN npm i -g turbo@^2
WORKDIR /app
COPY . .
RUN turbo prune server --docker

FROM node:22-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=server

RUN pnpm --filter=server deploy --prod /app/deploy

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json .
COPY --from=builder /app/apps/server/dist ./dist

EXPOSE 3001
CMD ["node", "dist/index.js"]
