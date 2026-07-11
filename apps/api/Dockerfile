# Imagem do tier sempre-ligado: BFF + triagem-pool na MESMA task (P-96/RAD-59).
# Build a partir da RAIZ do monorepo (o pacote depende de @radar/* por workspace):
#   docker build -f apps/api/Dockerfile -t radar-api .
# Para publicar no registro, a arquitetura precisa casar com a task def (`cpu_architecture`,
# default X86_64) — num Mac (arm64) isso EXIGE `--platform`, senão a task nunca sobe:
#   docker buildx build --platform linux/amd64 -f apps/api/Dockerfile -t <repo>:<sha> --push .
# Refs: arquitetura/08 §§2,6 (scan de imagem, P-56); docs/98 P-96; RAD-199

FROM node:22-alpine AS builder
WORKDIR /repo

RUN corepack enable

# O lockfile é copiado ANTES do código: mudar uma linha de TS não reinstala o mundo.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY modules ./modules
COPY shared ./shared

RUN pnpm install --frozen-lockfile

COPY apps/api ./apps/api

# `...` = "e as dependências dele": turbo constrói os @radar/* na ordem topológica antes da API.
RUN pnpm turbo build --filter=@radar/api...

# `pnpm deploy` monta um diretório AUTOCONTIDO: dist do pacote + node_modules de PRODUÇÃO com
# os workspace packages copiados (não symlinkados). Sem isso, o runtime herdaria os symlinks do
# monorepo e as devDependencies junto.
RUN pnpm --filter=@radar/api deploy --prod /app

# --- Runtime -------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Sem toolchain, sem pnpm, sem código-fonte: só o que roda. `node` (uid 1000) já existe na
# imagem base — o container NÃO roda como root (A07/baseline de segurança).
COPY --from=builder --chown=node:node /app ./

USER node
EXPOSE 3000

# O `dev`/`start` do package.json usam `--env-file=.env` (que não existe no container): a
# config vem do ambiente da task (env + secrets do cofre, RAD-199). Daí o entrypoint direto.
CMD ["node", "dist/index.js"]
