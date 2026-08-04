# syntax=docker/dockerfile:1

# RoleProof CLI image.
# Usage:
#   docker build -t roleproof .
#   docker run --rm -v "$PWD/fixtures:/work" roleproof analyze \
#     --resume /work/phase-1/strong-match/resume.txt \
#     --job /work/phase-1/strong-match/job.txt \
#     --no-ai --no-store --format json --stdout

FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++ git
RUN corepack enable

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm build

RUN pnpm --filter @roleproof/cli deploy --prod --legacy /out

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /home/node
COPY --from=build --chown=node:node /out ./app

USER node
WORKDIR /home/node/app

ENTRYPOINT ["node", "bin/roleproof.js"]
