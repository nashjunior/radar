-- Bootstrap EXECUTÁVEL das roles por-pool + timeouts (P-41/RAD-165, mecanismo B, arquitetura
-- 05 §6). Até aqui só existia em prosa em apply-db-pool-runbook.md — este script é o SQL
-- real. Criado por: RAD-191.
--
-- Pegadinha do P-41 (mesma do runbook): o pooler roda em MODO TRANSAÇÃO (RDS Proxy /
-- pgbouncer transaction) — um `SET` de sessão não sobrevive entre transações do mesmo
-- cliente lógico, porque a próxima transação pode cair numa conexão física diferente. Por
-- isso o timeout por-pool aqui é `ALTER ROLE ... SET`, que persiste em pg_db_role_setting e
-- é aplicado no CONNECT (antes de qualquer transação) — funciona mesmo sob pooling
-- agressivo. NÃO trocar por `SET` de sessão avulso.
--
-- Idempotente: seguro rodar mais de uma vez (roles via DO/checagem; ALTER ROLE SET é
-- idempotente por natureza). Requer privilégio CREATEROLE — roda uma vez por ambiente, fora
-- do proxy que ele mesmo está configurando (conexão direta ao cluster ou bastion).
--
-- Roles = identidade de CONEXÃO para o bulkhead por-workload (mecanismo B), não fronteira
-- de segurança/tenant — isolamento de dado é em nível de aplicação (tenantId, docs/05 §3);
-- RLS por tenant é Next (arquitetura/05 §3, DB7). Por isso os grants abaixo são amplos (nível
-- do usuário master atual), iguais entre as 5 roles.
--
-- Senha: setada FORA deste script, nunca hardcoded aqui (mesma regra do secret
-- `db-credentials` no runbook). Depois de rodar este script, gere uma senha forte por pool e
-- aplique via variável psql, por exemplo:
--   psql "$DATABASE_URL" -v pool=ingestao -v senha="$(openssl rand -base64 32)" \
--     -c 'ALTER ROLE :"pool" WITH LOGIN PASSWORD :'"'"'senha'"'"''
-- e registre o mesmo par em var.pools[<pool>].secret_arn (módulo db_proxy) para o RDS Proxy
-- autenticar como a role (mecanismo B, apply-db-pool-runbook.md).

-- ---------------------------------------------------------------------------
-- 1. Roles (idempotente)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingestao') THEN
    CREATE ROLE ingestao LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matching') THEN
    CREATE ROLE matching LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'triagem') THEN
    CREATE ROLE triagem LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analitico') THEN
    CREATE ROLE analitico LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs') THEN
    CREATE ROLE jobs LOGIN;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Timeouts por-pool — ALTER ROLE, não SET de sessão (ver pegadinha acima).
--    Valores de P-41 (docs/98, arquitetura/05 §6): 30/10/5/60/300 s;
--    lock_timeout=3s só nos pools quentes (ingestão + triagem/API).
-- ---------------------------------------------------------------------------

ALTER ROLE ingestao  SET statement_timeout = '30s';
ALTER ROLE ingestao  SET lock_timeout      = '3s';

ALTER ROLE matching  SET statement_timeout = '10s';

ALTER ROLE triagem   SET statement_timeout = '5s';
ALTER ROLE triagem   SET lock_timeout      = '3s';

ALTER ROLE analitico SET statement_timeout = '60s';

ALTER ROLE jobs      SET statement_timeout = '300s';

-- ---------------------------------------------------------------------------
-- 3. Privilégios — nível do usuário master atual (ver nota acima: identidade de
--    conexão, não fronteira de tenant). `jobs` ganha CREATE no schema além disso
--    (DETACH/ATTACH PARTITION e index build são DDL, arquitetura/05 §6).
--    ALTER DEFAULT PRIVILEGES cobre tabelas/sequences criadas por migrações futuras.
-- ---------------------------------------------------------------------------

GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO ingestao, matching, triagem, analitico, jobs;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ingestao, matching, triagem, analitico, jobs;
GRANT CREATE ON SCHEMA public TO jobs;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES    TO ingestao, matching, triagem, analitico, jobs;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO ingestao, matching, triagem, analitico, jobs;
