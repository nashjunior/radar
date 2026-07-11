# A05 · Teste de Estresse do Banco de Dados

> Refina o [A04](04-teste-de-estresse-e-falhas.md) para a **camada de dados** (PostgreSQL, arquitetura/01, §5). O banco é o ponto de convergência: a ingestão escreve em rajada, o matching lê pesado e a triagem lê/escreve — tudo concorrente. Os cenários aqui **derivam** dos de A04, §3. Alvos sem número real são `[A VALIDAR]` (dependem de P-31).

## 1. Perfil de carga no banco

As operações que dominam e onde cada uma dói:

- **Escrita em rajada (ingestão, S1):** *upserts* em massa por `numeroControlePNCP` durante bursts → *write amplification*, manutenção de índice, contenção de lock, geração de WAL.
- **Leitura de fan-out (matching, S4):** cada novo edital cruza com milhares de critérios (ou vice-versa) → *read amplification*, risco de *sequential scan*.
- **Concorrência (S3+S1):** ingestão (escrita) + matching (leitura) + triagem simultâneos → contenção, *MVCC bloat*, pressão de autovacuum. A triagem **lê `EXTRACAO_EDITAL` do cache** (1/edital) e **escreve `TRIAGEM` por perfil** (1/edital×empresa).
- **Range scans (reconciliação, S2):** varreduras por faixa de data em tabela grande → I/O e *cache hit ratio*.
- **Crescimento (meses de editais):** tamanho de índice e tabela → latência que degrada com o volume.

## 2. Cenários de estresse do banco

Cada um mapeia um cenário de A04, §3:

| ID | Deriva de A04 | Carga no banco | Gargalo provável | Alvo (hipótese `[A VALIDAR]`) |
|----|---------------|----------------|------------------|-------------------------------|
| **DB1** | S1 burst | upsert em massa de editais | lock / índice / WAL | throughput de escrita sustenta o frescor (≤ 30 min) |
| **DB2** | S4 fan-out | matching 1 edital × N mil critérios | plano de query, índices | p95 do matching < alvo; **sem seq scan** |
| **DB3** | S3 triagens | *lookup* de `EXTRACAO_EDITAL` (cache, 1/edital) + escrita de `TRIAGEM` por perfil | pool de conexões, lock | *cache hit* alto na extração; pool não satura |
| **DB4** | S2 reconciliação | range scan por data | I/O, cache | usa índice de data, não *scan* sequencial |
| **DB5** | S5 soak | carga contínua por horas | bloat, autovacuum, conexões | *dead tuples* e *bloat* estáveis; sem vazar conexão |
| **DB6** | crescimento | volume 10× acumulado | tamanho de índice/tabela | queries constantes com dados 10× (particionamento) |
| **DB7** | isolamento (Next) | filtro por `tenantId` sob carga | overhead de RLS, índice composto | isolamento sem degradar p95 |

## 3. O que o teste valida no schema (documento 12)

- **Índice único** em `numeroControlePNCP` — sustenta o *upsert* idempotente (arquitetura/02, §3).
- **Índices de matching:** `dataPublicacao`, `modalidadeCodigo`, `uf/regiao`, faixa de `valorEstimado`; **GIN/tsvector** para o full-text do objeto em `EXTRACAO_EDITAL` (documento 11, §5).
- **Índice composto `(clienteFinalId, …)`** nas tabelas de dado de cliente — `ALERTA`, `TRIAGEM`, `CRITERIO_MONITORAMENTO` (documento 05, §3) — pré-requisito do isolamento (DB7); o catálogo (`EDITAL`, `EXTRACAO_EDITAL`) é **global**, sem `tenantId`.
- **Split cache/aderência:** `EXTRACAO_EDITAL` 1:1 com edital (chave `editalId`, JSON pesado em `TOAST`) e `TRIAGEM` com único `(editalId, perfilId)` — é o que sustenta o cache (DB3).
- **`AUDIT_LOG`** *append-only*, particionado por data (documento 05, §3).
- **Particionamento por range de `dataPublicacao`** — escrita/purga eficientes e queries de editais recentes rápidas; partições frias arquiváveis (DB6).
- **Fan-out reverso (DB2):** dado um edital, achar critérios que casam é o inverso do padrão comum. No MVP, varrer critérios com filtros indexados; em escala, avaliar abordagem tipo *percolator* (matching reverso). `[A VALIDAR]`

**Decisão P-39 — particionamento + arquivamento (Eng/Artur, RAD-165, 2026-07-10; amarra P-05/P-44).** Particionamento **nativo declarativo por RANGE de data, granularidade mensal**, só nas tabelas quentes de crescimento contínuo / *append-only*:

| Tabela | Chave de partição | Retenção (05 §5) | Ciclo de vida |
|--------|-------------------|------------------|----------------|
| `EDITAL` | `dataPublicacao` (mensal) | ativo até encerramento + 24 m; frio até 5 anos | partições recentes quentes; `DETACH` p/ tablespace fria quando toda a partição já passou de encerramento + 24 m (conservador: > 36 m); agrega/anonimiza > 5 anos |
| `ALERTA` | `criadoEm` (mensal) | conta ativa + 24 m | *insert* só na partição corrente (concentra o *bloat* do fan-out); `DETACH`/arquiva partições vencidas; expurgo por conta no job de retenção |
| `PROVENIENCIA` | timestamp do evento (mensal) | *tombstone* mínimo 5 anos | *append-only*; `DROP PARTITION` > 5 anos |
| `AUDIT_LOG` | timestamp do evento (mensal) | *hot* 12 m + frio até 5 anos | *append-only*/fail-closed; 12 partições quentes, `DETACH` 13→60 p/ frio, `DROP` > 60 m |

- **Não particionar agora:** `EXTRACAO_EDITAL` (*point-lookup* 1:1 por `editalId`, JSON em `TOAST` — range não ajuda; p/ arquivar junto do `EDITAL` frio precisaria copiar `dataPublicacao`), `TRIAGEM` e `CRITERIO_MONITORAMENTO` (sem crescimento ilimitado nem *append-only*; acesso por chave/tenant). Reavaliar no *Next*.
- **Por tenant: adiado p/ o *Next*.** MVP é *single-tenant*/poucas contas (A06 §4); LIST/HASH por tenant hoje seria *no-op* com *skew*. O isolamento já sai do índice composto `(clienteFinalId, …)` + RLS (DB7). Revisitar quando a fatia de um tenant numa tabela quente — ou o *overhead* de RLS — justificar sub-partição.
- **Purga = `DROP`/`DETACH PARTITION`, nunca `DELETE` linha a linha** — O(1), sem tempestade de *vacuum*/*bloat*; casa com o expurgo automático versionado/auditado exigido por P-05.
- **Manutenção:** partição `DEFAULT` de guarda + job (scheduler do monólito, ou `pg_partman`+`pg_cron` no gerenciado) **pré-cria a partição do próximo mês** e roda o `DETACH`/arquivamento — mesmo scheduler da retenção (RAD-101). Independe de AWS (design); *tuning* fino confirma sob carga (A09/RAD-162, DB6).

## 4. O que medir

p95/p99 de query; throughput de escrita (linhas/s); **profundidade de locks/waits**; *cache hit ratio* (`shared_buffers`); *lag* e trabalho do autovacuum; *dead tuples* / bloat; saturação do **pool de conexões**; taxa de geração de WAL; *temp files* (queries que estouram `work_mem`); e, se houver réplica, *replication lag*.

## 5. Modos de falha do banco — o que fazer quando falhar

| Falha | Detecção | Resposta automática | Ação humana (runbook) |
|-------|----------|---------------------|-----------------------|
| **Pool de conexões esgotado** | erros de conexão, fila de espera | `pgbouncer` limita; *backpressure* na ingestão | achar query lenta segurando conexão; subir pool com cautela |
| **Lock contention no upsert** (DB1) | *lock waits* altos | lotes menores; `ON CONFLICT` enxuto; retry idempotente | reduzir escopo da transação; revisar ordem de escrita |
| **Matching vira seq scan** (DB2) | *seq scan*, p95 explode | `statement_timeout` corta a query | criar/ajustar índice; `ANALYZE`; reescrever query |
| **Autovacuum não acompanha** (DB5) | *dead tuples*, bloat, tabela crescendo | tuning de autovacuum; *throttle* de escrita | vacuum manual; ajustar thresholds por tabela |
| **I/O saturado** (DB4) | *IO wait*, *temp files* | *throttle*; ler de réplica | escalar IOPS; particionar; subir `work_mem` |
| **Réplica com lag** | *replication lag* > limiar | rotear leitura crítica ao primário | investigar carga/rede da réplica |
| **Índice/tabela grande demais** (DB6) | tamanho, latência subindo | particionamento ativo | arquivar partições frias; remover índice não usado |
| **Hot partition / hot row** | contenção num registro/partição | — | rever design (ex.: contador agregado, sharding de chave) |
| **Falha de nó / corrupção** | health check, checksums | *failover* para standby | *restore* PITR (WAL archiving); RCA |

## 6. Estratégias PostgreSQL aplicadas

- **Upsert em lote** com `ON CONFLICT (numeroControlePNCP) DO UPDATE` — idempotência que torna retry seguro (arquitetura/02).
- **Connection pooling (`pgbouncer`)** — obrigatório com workers assíncronos; sem ele o pool satura em DB3.
- **Particionamento por range de data** — casa com o padrão "escreve o novo, lê o recente, arquiva o velho".
- **Índices parciais/compostos + GIN** para matching (documento 11, §5); `statement_timeout` e `lock_timeout` para uma query ruim não travar tudo.
- **Réplicas de leitura** para Inteligência de Mercado (*Later*) e reconciliação — *bulkhead* no nível de dados, isolando análise do caminho de escrita (espelha A04, §7).
- **Backup contínuo / PITR** (arquivamento de WAL) para recuperação.

```mermaid
flowchart LR
    W[Workers assíncronos] --> PB[pgbouncer · pool]
    PB -->|escritas| PRI[(Primário)]
    PB -->|leitura analítica<br/>+ reconciliação| REP[(Réplica de leitura)]
    PRI -->|streaming| REP
    PRI --> PART[Tabelas particionadas<br/>por data · quente/fria]
    PRI -->|WAL archiving| PITR[(Backup / PITR)]
```

**Decisão P-41 — *sizing* inicial de pool + timeouts + `work_mem` (Eng/Artur, RAD-165, 2026-07-10).** Valores de **partida** (design; *tuning* fino sob carga em A09/RAD-162). Todo acesso passa por **pooler em modo transação** (RDS Proxy no gerenciado / `pgbouncer transaction` self-hosted) — multiplexa transações OLTP curtas e é o que segura a explosão de conexão dos *workers* + do *seam* serverless (P-27). *Ressalva:* modo transação proíbe estado de sessão entre transações — sem `SET` de sessão, sem *advisory lock* de sessão, sem *prepared statement* nomeado que fixe (*pin*) a conexão; `SET LOCAL` (escopo de transação) é permitido.

- **`max_connections` do Postgres = 200** (modesto de propósito; concorrência *ativa* útil num OLTP ≈ (vCPU×2)+I/O ≈ dezenas). Os pools somam < 200 com folga p/ admin/superuser.
- **Bulkheads por *workload*** — isola a rajada da ingestão do caminho crítico do alerta (DB3, "pool dedicado"):

| Pool | `default_pool_size` (backends PG) | `statement_timeout` | Papel |
|------|-----------------------------------|---------------------|-------|
| Ingestão (upsert/escrita) | 15 | 30 s | rajada S1; lotes sob lock |
| Matching (leitura/fan-out) | 10 | 10 s | ~4–10× o gate DB2 (p95 1–2,5 s) antes de matar um *seq scan* |
| Triagem/API (interativo) | 10 | 5 s | **protegido** — serve o alerta; SQL aqui é sub-segundo |
| Analítico/reconciliação | 5 | 60 s | *range scans* DB4; vai p/ réplica quando P-42 |
| Jobs/retenção/partição | 5 | 300 s | `DETACH`/*index build*; roda fora de pico |

- **`max_client_conn` do pooler alto (2.000–5.000)** p/ absorver o fan-out de *workers*/serverless; só os `default_pool_size` acima viram *backends* reais.
- **`lock_timeout = 3 s`** nos pools interativo + ingestão — *upsert* bloqueado falha rápido e re-tenta idempotente (DB1) em vez de empilhar *lock wait*.
- **`idle_in_transaction_session_timeout = 30 s`** — mata transação vazada e protege o pool (DB5, "sem vazar conexão").
- **`work_mem = 16 MB` global** (é por nó de *sort*/*hash* × conexão — 16 MB limita o total e evita *temp file* no fan-out típico de 1–5 mil critérios). Query analítica sobe local com `SET LOCAL work_mem='128MB'` **só no pool analítico** — nunca global.
- **`maintenance_work_mem = 512 MB–1 GB`** p/ *index build*/`ATTACH`/*vacuum*; `autovacuum_work_mem` à parte. `shared_buffers` ≈ 25% da RAM e `effective_cache_size` ≈ 70% são a moldura do *cache hit ratio* de §4.
- **Autovacuum agressivo por tabela** em `EDITAL`/`ALERTA` (*churn* de upsert): `autovacuum_vacuum_scale_factor ≈ 0,02` + `cost_limit` maior — e as partições mensais menores (P-39) fazem o *vacuum* acompanhar (DB5).

## 7. Ligação com A04 e critério de aceite

Estes cenários detalham a linha "**Banco sobrecarregado**" do runbook de A04 (§5) e a degradação de A04 (§6): sob pressão, faz-se *throttle* da **escrita** (ingestão) para preservar a **leitura** que serve o alerta de prazo — coerente com a ordem de preservação (nunca sacrificar o alerta crítico). O banco "passa" quando sustenta os NFRs de DB1–DB5 sob a carga-alvo e degrada como em §5 sob falha. Compõe o gate de release junto com A04 (documento 07, §6).

## 8. Pendências

- Estratégia de particionamento (por data e/ou tenant) e política de arquivamento. `Resolvido — P-39 (RAD-165, 2026-07-10)` → §3.
- Abordagem de fan-out reverso do matching em escala (scan vs. percolator). `[A VALIDAR]` → P-40
- *Sizing* do pool de conexões e limites de `statement_timeout`/`work_mem`. `Resolvido — P-41 (RAD-165, 2026-07-10)` → §6.
- Quando introduzir réplicas de leitura e o que roteia para elas. `[A VALIDAR]` → P-42

Rastreadas em [../docs/98](../docs/98-decisoes-e-pendencias.md).
