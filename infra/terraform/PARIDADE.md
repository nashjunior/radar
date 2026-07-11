# Paridade e swap — o gate obrigatório antes de trocar (RAD-181)

> **Regra do issue (Nash, 2026-07-10):** o `terraform plan` do `-next` tem que dar
> ***no changes*** vs. o estado atual. Contratos melhores, **MESMA** infra. Se o plan quiser
> recriar/alterar recurso, **ainda não pode trocar**.

## Por que a paridade se sustenta por construção

`terraform plan` compara o **estado remoto ↔ config resolvida de cada recurso**, endereçado
por `module.<nome>.<tipo>.<nome>[<key>]`. Este rewrite **preserva todos os três**:

1. **Mesma instância de módulo no stack** (`module.database`, `module.db_proxy`) → mesmo
   prefixo de endereço.
2. **Mesmo `resource "<tipo>" "<nome>"`** em cada módulo → mesmo endereço de recurso.
3. **Mesma config resolvida** — só nomes de `variable`/`output` mudaram; os *valores* que
   chegam a cada atributo são idênticos.

Logo o diff de recurso é vazio. As únicas mudanças são de **interface** (nomes de var/output),
invisíveis ao `plan`.

## Matriz de endereços — módulos de referência (database, db_proxy)

Todo endereço abaixo existe **idêntico** no atual e no `-next`. Nenhum recurso foi
adicionado, removido, renomeado ou movido.

### `module.database`

| Endereço de recurso | Atual | `-next` | Config resolvida |
|---|---|---|---|
| `aws_db_subnet_group.this` | ✓ | ✓ | igual (`subnet_ids` ← `private_subnet_ids`, mesmo valor) |
| `aws_security_group.db` | ✓ | ✓ | igual (`vpc_id` ← `network_id`, mesmo valor) |
| `aws_vpc_security_group_egress_rule.db_all` | ✓ | ✓ | igual |
| `aws_db_parameter_group.this` | ✓ | ✓ | igual (6 parâmetros P-41 byte-a-byte) |
| `aws_rds_cluster.this` | ✓ | ✓ | igual (`kms_key_id` ← `encryption_key_ref`; `min_capacity` `?0.5:0.5`→`0.5` resolve igual) |
| `aws_rds_cluster_instance.writer` | ✓ | ✓ | igual |

Input removido: `vpc_cidr` (não referenciado por nenhum recurso desde o proxy-only) → zero
impacto de `plan`.

### `module.db_proxy`

| Endereço de recurso | Atual | `-next` | Config resolvida |
|---|---|---|---|
| `data.aws_iam_policy_document.assume` | ✓ | ✓ | igual |
| `aws_iam_role.proxy` | ✓ | ✓ | igual |
| `data.aws_iam_policy_document.secret_access` | ✓ | ✓ | igual (`secret_ref`/`region`/`encryption_key_ref` ← mesmos valores) |
| `aws_iam_role_policy.proxy` | ✓ | ✓ | igual |
| `aws_security_group.proxy` | ✓ | ✓ | igual (`network_id`/`network_cidr` ← mesmos valores) |
| `aws_vpc_security_group_ingress_rule.db_from_proxy` | ✓ | ✓ | igual (`db_firewall_group_ref` ← mesmo valor) |
| `aws_db_proxy.this[*]` | ✓ | ✓ | igual p/ cada pool (`secret_ref`/`cluster_ref`) |
| `aws_db_proxy_default_target_group.this[*]` | ✓ | ✓ | igual |
| `aws_db_proxy_target.this[*]` | ✓ | ✓ | igual (`cluster_ref` ← mesmo valor) |
| `aws_cloudwatch_metric_alarm.session_pinned[*]` | ✓ | ✓ | igual (`alarm_topic_ref` ← mesmo valor) |

> Os `[*]` são as chaves de `var.pools` (ingestao/matching/triagem/analitico/jobs no default;
> o que o stack passar). As chaves **não mudam** → mesmos endereços indexados.

## Procedimento de validação (requer tofu + credenciais AWS — GATED)

Este ambiente **não tem** `tofu`/`terraform` nem credenciais/estado remoto AWS do Radar
(mesma frente de unblock de RAD-134/RAD-130). O gate roda onde há tooling:

```sh
# 1. Sintaxe/tipos de cada módulo do -next (não precisa de credencial):
for m in infra/terraform-next/modules/*/; do (cd "$m" && tofu init -backend=false && tofu validate); done

# 2. Paridade por stack (precisa do backend de estado + credencial do env):
#    aponta o -next para o MESMO backend/estado do stack atual e planeja.
cd infra/terraform-next/stacks/dev
tofu init   # mesmo backend.tf do stack atual (mesmo bucket/lock/key)
tofu plan -detailed-exitcode -var-file=... 
#    exit 0 = SEM mudança  → paridade PROVADA para dev
#    exit 2 = há diff      → contrato quebrou paridade; NÃO trocar; corrigir
# repetir para staging e prod.
```

`-detailed-exitcode` é o gate objetivo: **exit 0 (no changes) é a única luz verde**.

### Paridade de provider — pin obrigatório antes do `plan` (senão o gate dá *falso* `exit 2`)

O `.terraform.lock.hcl` dos stacks atuais fixa **`hashicorp/aws 5.100.0`**
(`registry.opentofu.org/hashicorp/aws`). Atual e `-next` têm o **mesmo constraint**
(`required_version >= 1.9`, `hashicorp/aws >= 5.98, < 6.0`) — mas o `-next` **não tem
lock file**. Sem lock, o `tofu init` do `-next` resolve o provider **mais novo** dentro de
`< 6.0`; se sair um patch > 5.100.0 até a hora do gate, o `plan` compara o estado (gerado
com 5.100.0) contra config resolvida por outra versão de provider → defaults/computeds
podem divergir → **`exit 2` que NÃO é quebra de contrato, e sim skew de provider**.

Para o `plan` testar só o rename (o que a paridade promete), **pin o mesmo build 5.100.0
antes do `init` do `-next`**:

```sh
# copie o lock do stack atual para o -next ANTES do init (mesmo runner do apply Cognito):
cp infra/terraform/stacks/dev/.terraform.lock.hcl infra/terraform-next/stacks/dev/.terraform.lock.hcl
# idem staging/prod. Depois: tofu init  →  seleciona 5.100.0 (mesmo build do estado)  →  plan.
```

Como o gate roda no **mesmo runner tofu-enabled/credenciado do apply Cognito** (RAD-134),
os hashes do lock já são válidos ali. Alternativa equivalente: `tofu init` e **confirmar**
que a versão resolvida é 5.100.0 antes de confiar no `plan`. Pós-swap, manter o lock
versionado torna o `apply` reproduzível.

## Swap atômico (só após exit 0 nos três envs)

`infra/terraform/scripts/` (runbooks + `ab3-evidence.sh`) **não** foi reescrito — segue
válido e precisa **sobreviver ao swap**. Um `git rm -r infra/terraform` cego o apagaria
(o `-next` só tem `modules/` + `stacks/`). Por isso o swap **preserva `scripts/`**:

```sh
# 1. Carrega os scripts (não-reescritos) para dentro do -next antes do swap:
git mv infra/terraform/scripts infra/terraform-next/scripts
# 2. Troca módulos+stacks pelos do -next:
git rm -r infra/terraform
git mv infra/terraform-next infra/terraform
# 3. Reapontar quaisquer paths em CI (.github/workflows) e scripts/ que citem terraform-next.
```

O `-next` compartilha o `backend.tf` (mesmo estado) dos stacks atuais — por isso o `plan`
enxerga o estado real e, pós-swap, o `apply` continua sobre o mesmo estado, sem reimport.

## Estado do gate (2026-07-11)

- **Todos os 9 módulos + 3 stacks (RAD-182):** escritos e commitados (`c9466f8`).
  Paridade de **endereço** provada estaticamente (byte-a-byte, sem tooling): 9/9 módulos
  com `resource`/`data` idênticos; 3/3 stacks com mesmas instâncias de módulo, mesmo
  `backend.tf` (bucket/lock/key/`sa-east-1`) e mesmas chaves de `for_each`
  (`pools`/`functions`: ingestao/matching/triagem). Único delta = renames de interface
  (invisíveis ao estado) + comentários.
- **Paridade de provider:** constraint idêntico nos dois trees; lock do atual fixa
  `hashicorp/aws 5.100.0`, `-next` sem lock → **pin obrigatório antes do `init`** (ver
  seção "Paridade de provider" acima), senão o gate dá falso `exit 2`.
- **Falta o `plan` objetivo (`exit 0`)** — **gated em tooling/creds**. Refinamento do
  caminho: o gate deve rodar na **mesma sessão credenciada e no mesmo runner tofu-enabled
  do apply Cognito** (RAD-134), não num runner novo. **O swap só acontece com `plan` limpo
  nos 3 envs.**
- **Owner do unblock:** decisão de conta/creds AWS = usuário/Nash (interação
  `interaction:RAD-134:aws-account-decision`, RAD-130); execução do gate = runner
  tofu-enabled co-localizado (frente RAD-134/RAD-130).

### Pré-flight estático estendido (2026-07-10, Artur — RAD-182)

Além da paridade de **endereço** acima, rodei um gate estático mais fundo — a camada que o
`tofu validate` cobriria (indisponível: sem tooling) e que antecipa o que o `plan -exit 0`
vai confirmar. **Todos passaram.** Método reproduzível (grep/diff + parser Python de blocos,
sem credencial):

1. **Endereços de recurso (9/9 módulos):** conjunto `resource`/`data` `<tipo>.<nome>`
   idêntico byte-a-byte old↔next. Sem add/remove/rename/move → sem destroy/create.
2. **Instâncias de módulo (3/3 stacks):** mesmas 9 instâncias por env; mesmas chaves de
   `for_each` (`functions`: ingestao/matching/notificacao; `pools` do `db_proxy` internos e
   preservados).
3. **Literais de config resolvida (`main.tf`, comentários/`description` removidos):** 7/9
   módulos byte-idênticos. Os 3 deltas restantes são **inócuos**:
   - `compute`: `${var.ecr_image_uri}` → `${var.container_image_uri}` (rename puro, mesmo valor).
   - `serverless`/`db_proxy`: `${var.aws_region}` → `${var.region}` no host do endpoint
     Secrets Manager (rename puro, mesmo valor).
   - `database`: `min_capacity = var.env == "prod" ? 0.5 : 0.5` → `min_capacity = 0.5`
     (ternário no-op colapsado; **resolve a `0.5` em todo env**, antes e depois → zero diff).
4. **Substituto do `tofu validate` (consistência de rename, o que faria o gate falhar cedo):**
   - Nenhum `var.X` referenciado dentro de um módulo sem `variable "X"` declarado (9/9).
   - Todo input top-level que o stack passa mapeia para uma `variable` do módulo (3 env × 9 mód).
   - Todo `module.<inst>.<output>` referenciado nos stacks resolve para um `output` real.
   → sem rename meio-aplicado / referência pendente.
5. **Fronteira back↔front (regra CLAUDE.md):** nomes de output do `identity`
   (`issuer_url`/`jwks_uri`/`tenant_claim`, consumidos pelo BFF) e os outputs de stack
   **inalterados** → **nenhum aviso ao front necessário** (Flávia).
6. **Guardrails P-41 (RAD-165):** literais de `max_connections_percent`/`max_idle`/
   `connection_borrow_timeout` do `db_proxy` e os pisos do parameter group
   (`max_connections`/`work_mem`/`idle_in_transaction`/`statement_timeout`/`lock_timeout`)
   **byte-idênticos**; seam serverless `enabled=false`/`count` gated-off preservado.

**Conclusão:** a paridade se sustenta por construção *e* por auditoria estática de valores
resolvidos, não só de endereços. Quando o runner credenciado (RAD-134) rodar
`tofu plan -detailed-exitcode` com o lock pinado em 5.100.0, o resultado esperado é **exit 0**
nos 3 envs; qualquer `exit 2` seria skew de provider (ver seção acima), não quebra de contrato.
O swap continua **gated** só nesse `plan` objetivo + creds.

## Swap executado — gate movido para a pipeline (2026-07-11, Nash)

**Decisão do Nash (comentário RAD-181, 2026-07-11):** *"nesse caso só substituir e testar
na pipeline"*. Com o `tofu plan` credenciado indisponível localmente (mesma frente
RAD-134/RAD-130), o gate de paridade **deixa de ser** o `plan -exit 0` local **e passa a ser
a pipeline** — o rewrite vira o oficial e a CI o exercita.

**O que foi feito:** `infra/terraform-next/` → `infra/terraform/` (swap in-place, mesmo path).
`modules/` + `stacks/` substituídos pelo rewrite; `README.md`/`PARIDADE.md` trazidos junto;
`scripts/` (runbooks + `ab3-evidence.sh`) **preservados**. `backend.tf` dos 3 stacks
**inalterado** (só comentário) → mesmo estado remoto, sem reimport. `.terraform.lock.hcl`
**não versionado** (status quo do tree atual) — a CI usa `hashicorp/setup-terraform`
(registry.terraform.io) e um lock com hashes do **opentofu** quebraria o `init`; o lock
versionado (registry HashiCorp, pin 5.100.0) fica para o runner credenciado pós-primeiro `init`.

**O que a pipeline testa (Gate 8 `terraform-validate`, `ci.yml`):** `terraform init
-backend=false` + `terraform validate` nos 3 stacks (dev/staging/prod), em push e PR para
`main`. Cobre sintaxe, wiring de `variable`/`output`, provider — o substituto de `tofu
validate` que o pré-flight antecipou estaticamente. **Não** roda `plan` (segue creds-gated).

**O que a pipeline NÃO prova:** o `plan -exit 0` (state-parity) — ainda depende de creds/estado
AWS. Isso é confirmado no **primeiro `apply` real** (AWS-account gated, RAD-134). A paridade de
**endereço + config resolvida** já está provada estaticamente (seções acima), então o risco
residual do swap é baixo e **100% reversível por git** (revert do commit restaura o tree antigo).

### Validação `tofu validate` real (2026-07-11, Artur — RAD-182)

Fecho o gap que o pré-flight acima sinalizou (*"a camada que o `tofu validate` cobriria —
indisponível: sem tooling"*): **instalei OpenTofu v1.12.3 e rodei o `tofu validate` de
verdade**, com o provider real `hashicorp/aws v5.100.0` (o pin do lock). Sem credencial:
`tofu init -backend=false` (não toca o backend S3) + `tofu validate`.

| Alvo | Resultado |
|---|---|
| `terraform-next/stacks/staging` | ✅ `Success! The configuration is valid.` |
| `terraform-next/stacks/dev`     | ✅ `Success! The configuration is valid.` |
| `terraform-next/stacks/prod`    | ✅ `Success! The configuration is valid.` |
| `tofu fmt -check -recursive` (todo o `-next`) | ✅ limpo (0 arquivos a reformatar) |
| `terraform/stacks/staging` (atual — controle) | ✅ valid → **paridade de validade** confirmada |

O que o `validate` real adiciona sobre o pré-flight estático: exercita o **schema do
provider** (tipos de atributo, blocos obrigatórios, expressões) que o parser grep/Python não
alcança. Passar nos 3 envs com o provider pinado prova que o rewrite não tem erro de
sintaxe/tipo/referência — **nenhum erro "validate-catchable" está esperando o apply**.
Lockfiles `hashicorp/aws 5.100.0` gerados e versionados nos 3 stacks do `-next` (cumpre o
pin exigido pelo gate). Os `.terraform/` (cache de provider, centenas de MB) foram removidos
pós-run; ficam só os `.terraform.lock.hcl` (versionados por design).

**Ainda gated (inalterado):** resta só o `tofu plan -detailed-exitcode` (exit 0) nos 3 envs,
que precisa de **creds AWS reais + backend S3** — frente RAD-134 (interação
`interaction:RAD-134:aws-account-decision`, owner Nash). `validate` ✅ + paridade estática ✅
⇒ o `plan` credenciado é o **único** passo restante antes do swap atômico.
