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

## Estado do gate (2026-07-10)

- **Módulos de referência (database, db_proxy):** paridade **provada por inspeção**
  (matriz acima). Falta o `plan` objetivo (`exit 0`) — **gated em tooling**.
- **Demais módulos + stacks:** a escrever (RAD-182), depois entram nesta mesma matriz e no
  `plan`. **O swap só acontece com o `-next` completo e `plan` limpo nos 3 envs.**
- **Owner do unblock de tooling/creds:** DevOps (frente RAD-134/RAD-130).
