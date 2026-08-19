# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM base AS runner
WORKDIR /repo
ENV NODE_ENV=production
# Copy the whole workspace, node_modules included. Next's `output: standalone`
# tracing does not survive pnpm's symlinked store — it drops next's own
# @swc/helpers and the server dies on boot. See apps/web/next.config.mjs.
COPY --from=build /repo ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# No -p and no PORT default: Railway injects PORT and `next start` reads it.
# Passing -p would pin a port the edge proxy is not forwarding to.
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
