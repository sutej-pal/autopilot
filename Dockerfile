FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CI=1

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @autopilot/web build

ENV NODE_ENV=production
USER root
EXPOSE 10000
CMD ["node", "scripts/render-start.mjs"]
