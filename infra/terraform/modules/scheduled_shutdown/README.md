# `scheduled_shutdown` — desligar o dev fora do horário (RAD-225)

Desliga o compute do ambiente **dev** à noite e no fim de semana, e religa no início do
expediente. Só o compute: storage, ALB, NAT e RDS Proxy seguem cobrados.

Economia esperada: Aurora (~US$ 50/mês) + Fargate (~US$ 18/mês) passam a rodar ~40-50h das
168h da semana — algo entre 65% e 70% do compute ocioso.

**Exclusivo de dev.** Uma `validation` em `var.env` recusa `prod`/`staging`.

## Por que dois mecanismos diferentes

Aurora e ECS são desligados por caminhos distintos, e **isto não é acidente**:

| Serviço | Mecanismo | Por quê |
|---|---|---|
| Aurora | EventBridge Scheduler + Universal Target (`aws-sdk:rds`) | Parar um cluster é uma chamada de API (`StopDBCluster`). O Universal Target invoca o SDK direto — sem Lambda intermediário para manter. |
| ECS | Application Auto Scaling scheduled action | Ver abaixo. |

### O ECS **não** pode ser desligado com `UpdateService`

O caminho intuitivo — `ecs:UpdateService` com `DesiredCount = 0` — **não funciona aqui**, e
falha de um jeito silencioso: o `apply` fica verde, o agendamento dispara, o serviço vai a
zero… e volta a 1 em minutos.

O módulo `compute` registra um `aws_appautoscaling_target` com `min_capacity = 1`. O
Application Auto Scaling reconcilia a capacidade do serviço para dentro de `[min, max]` — ele
desfaz o `UpdateService` por baixo. A economia do Fargate simplesmente não aconteceria, e o
sintoma (uma fatura que não cai) só apareceria no fim do mês.

O mecanismo correto é mover o **próprio `min`/`max` do scalable target**: com `min = max = 0` o
autoscaling drena o serviço a zero e o *mantém* lá; no religar, `min = 1` o traz de volta.
É o que `aws_appautoscaling_scheduled_action` faz.

## Horários

Os crons são interpretados em `var.timezone` (`America/Sao_Paulo`), **não em UTC** — tanto o
EventBridge Scheduler (`schedule_expression_timezone`) quanto o Application Auto Scaling
(`timezone`) recebem o fuso explicitamente.

Escreva os horários como o time os lê no relógio. **Não pré-converta para UTC**: fazer as duas
coisas (converter *e* declarar o fuso) desliga o dev no meio do expediente.

- Stop: `cron(0 20 ? * MON-FRI *)` → 20:00 BRT, seg-sex
- Start: `cron(0 8 ? * MON-FRI *)` → 08:00 BRT, seg-sex

**Fim de semana** sai de graça: o stop de sexta 20:00 vale até o start de segunda 08:00 —
sábado e domingo não têm start, então nada religa. Não é preciso um schedule dedicado.

## Custo de exit (A08 §6) — este módulo é **100% provider-bound**

Ao contrário de `database`/`queue`/`storage`, aqui **não há primitiva portável a preservar**:
"parar um cluster gerenciado" e "mexer no min/max de um scalable target" não têm equivalente
honesto fora da AWS. O contrato é nomeado com honestidade (`aurora_cluster_ref`,
`ecs_cluster_name`) em vez de fingir neutralidade — expor o binding custa menos do que escondê-lo.

Numa troca de provedor, este módulo **se joga fora e se reescreve inteiro**:

| Recurso | Substituto no destino |
|---|---|
| `aws_scheduler_schedule` (+ IAM role) | Cloud Scheduler (GCP) / Logic App ou Automation (Azure) |
| Universal Target `aws-sdk:rds:stop\|startDBCluster` | `gcloud sql instances patch --activation-policy` / `az postgres server stop` |
| `aws_appautoscaling_scheduled_action` | autoscaler schedule do Cloud Run / Container Apps |

O custo é **baixo e contido**: ~130 linhas, nenhum outro módulo depende dele, e ele não guarda
estado. É por isso que o binding vive aqui, e não espalhado dentro de `database`/`compute` — o
`scheduled_shutdown` é o **para-choque** que concentra a parte não-portável da economia de custo.
Deletá-lo devolve o dev ao comportamento sempre-ligado, sem tocar em mais nada.

## Contratos com o módulo `compute`

- `ecs_min_capacity_on` / `ecs_max_capacity_on` **devem espelhar** o `min_capacity` /
  `max_capacity` do `compute`. São os valores para os quais o religar restaura o target; se
  divergirem, o dev acorda com uma capacidade que ninguém declarou.
- O `resource_id` do scalable target é montado por string (`service/<cluster>/<service>`), então
  o grafo do Terraform não enxerga a aresta até o `compute`. O stack passa `depends_on =
  [module.compute]` — sem isso o apply pode tentar criar o agendamento antes do target existir.

## Ao aplicar (RAD-134)

1. **Verificar o auto-pause do Aurora.** O stack dev tenta `min_capacity_acu = 0` com o RDS
   Proxy anexado, e a AWS pode não suportar scale-to-zero nessa configuração. Se o cluster
   **não** cair a 0 ACU quando ocioso, os schedules deste módulo são o plano A — e aí
   `min_capacity_acu` deve voltar a `0.5` no dev, para não deixar configuração morta no stack.
   Se o auto-pause **engatar**, os schedules do Aurora viram redundância e podem sair (os do
   ECS continuam necessários de qualquer forma).
2. **⚠️ Paridade: `plan` NÃO é limpo no dev fora do horário.** Este é o preço consciente do
   mecanismo, e precisa estar dito: o `aws_appautoscaling_scheduled_action` muda o `min`/`max`
   do scalable target **em runtime**, enquanto o `aws_appautoscaling_target` do `compute` os
   declara como `1`/`2` no código. Com o dev desligado (min=max=0 no estado real), um
   `tofu plan -detailed-exitcode` acusa drift e sai `2` — e o apply restaura `1`/`2`, religando
   o serviço até o próximo stop.

   Consequência prática: **rode `plan`/`apply` do dev dentro do horário comercial**, quando código
   e realidade coincidem. O gate de paridade da RAD-181 (`plan` = no changes) continua válido
   para `prod`/`staging`, que não têm este módulo. Se isso incomodar no CI, a saída é
   `ignore_changes = [min_capacity, max_capacity]` no target — mas só no dev, e ao custo de o
   autoscaling do dev deixar de ser governado pelo código.
3. **A AWS religa sozinha um cluster parado após 7 dias.** Irrelevante aqui — o start de toda
   segunda chega bem antes —, mas vale saber se os schedules forem desabilitados por um período
   longo: o Aurora volta a cobrar sem avisar.

Refs: RAD-225, RAD-199 (compute/edge), RAD-134 (unblock de AWS), P-41 (RDS Proxy), P-67.
