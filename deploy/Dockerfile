# One image for every role: TERRARIUM_ROLE=all|control|worker decides what a container does.
#   docker build -f deploy/Dockerfile -t terrarium:latest .
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production
EXPOSE 8787
# Sessions run in worker threads from TypeScript sources (ADR-0027), so the image needs no compile step.
USER node
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
