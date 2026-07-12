# Módulo `compute` — container quente (RAD-181/RAD-182)

Container quente para `apps/api`. Binding hoje = AWS ECS Fargate. Contrato usa
`container_image_uri`, `*_secret_ref`, `region` (neutros); recursos internos são
ECS/Fargate-bound.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Imagem OCI | `container_image_uri` | ECR URI |
| Região | `region` | AWS region string |
| Handle de segredo | `*_secret_ref` | Secrets Manager ARN |
| CPU / memória | `cpu`, `memory` | ECS CPU units / MiB |
| Piso / teto de réplicas | `min_capacity`, `max_capacity` | `aws_appautoscaling_target` min/max |
| Alvo de utilização | `cpu_target_percent`, `memory_target_percent` | target value da política |
| Cooldowns | `scale_out/in_cooldown_seconds` | cooldown da política |
| Firewall do pooler | `pooler_firewall_group_ref` | security group id do RDS Proxy |
| Handles das filas | `queue_refs` | SQS queue ARNs |
| Chave de cifra | `encryption_key_ref` | KMS key ARN |
| Role de serviço do Bedrock batch | `bedrock_batch_service_role_ref` | IAM role ARN |
| Bucket de I/O do batch | `batch_bucket_ref` | S3 bucket ARN |

## O que é provider-bound (custo real de exit → GCP Cloud Run / Azure Container Apps)

- **ECS cluster + task definition** — em GCP Cloud Run é um `google_cloud_run_v2_service`;
  em Azure Container Apps é um `azurerm_container_app`. Semântica de task-def (família,
  revisões, compatibilidades) não tem equivalente direto.
- **`requires_compatibilities = ["FARGATE"]`** — serverless compute AWS; em GCP Cloud Run
  é serverless por design; em Azure Container Apps é o modo "Consumption".
- **`network_mode = "awsvpc"`** — cada task ganha sua própria ENI; em GCP/Azure a rede é
  configurada no serviço, não na task definition.
- **`AmazonECSTaskExecutionRolePolicy`** — ARN de política gerenciada AWS; em GCP/Azure
  são roles de serviço diferentes.
- **`awslogs` log driver** — em GCP é `gcr.io/google-containers/fluentd-gcp`; em Azure é
  Azure Monitor / Log Analytics via configuração do container group.
- **Container Insights** — CloudWatch-specific; em GCP é Cloud Monitoring; em Azure é
  Azure Monitor Container Insights.
- **`aws_ecs_service`** — o conceito "serviço que mantém N réplicas da task de pé" existe em
  todo lugar, mas o recurso separado (cluster ↔ service ↔ task-def) é ECS. Em Cloud Run o
  serviço *é* a unidade (não há task-def solta); em Container Apps idem.
- **Application Auto Scaling (`aws_appautoscaling_target` + `_policy`)** — este é o item de
  exit mais caro do módulo. A AWS modela escala como **dois recursos separados** (registrar
  um alvo escalável `ecs:service:DesiredCount`, depois anexar políticas). **Cloud Run e
  Container Apps não têm equivalente**: escala é *campo do próprio serviço*
  (`min_instance_count`/`max_instance_count` no Cloud Run; `scale { rules }` no Container
  Apps). Exit = colapsar 3 recursos em atributos de 1 → o contrato (`min_capacity`,
  `max_capacity`, `*_target_percent`) sobrevive; a topologia de recursos, não.
- **Métricas predefinidas (`ECSServiceAverageCPUUtilization`, `ALBRequestCountPerTarget`)** —
  nomes CloudWatch. Cloud Run escala por concorrência/CPU; Container Apps por KEDA scalers.
- **`request_scaling_target_ref`** — provider-bound assumido: a AWS não aceita o ARN do
  target group aqui, exige o *resource label* `app/<lb>/<id>/targetgroup/<tg>/<id>`. É a
  única variável do módulo cujo valor não é um handle opaco, e por isso está documentada.

## Os três pré-requisitos — fechados em RAD-199

O módulo ficou fora dos stacks de propósito até RAD-199: instanciá-lo antes criaria um serviço
cujas tasks nunca sobem, e o `apply` sairia **0** assim mesmo (ECS não falha o apply quando a
task morre no boot — o serviço só fica com 0 task sã). O que faltava, e onde ficou:

1. **Rota de saída da sub-rede privada** → `vpc.egress_gateway_count` (NAT + route table
   privada + gateway endpoint de object storage). Sem saída, a task não puxa imagem nem lê
   segredo. NAT é obrigatório: PNCP e LLM são destinos **públicos** (A08 §5).
2. **Imagem do container** → módulo `registry` (ECR, scan on push, tag imutável em prod) +
   `apps/api/Dockerfile` (build do monorepo, runtime não-root).
3. **Borda (ingress)** → módulo `edge` (**P-55 decidida: ALB + WAF**). Dá o `target_group_ref`,
   o `edge_firewall_group_ref` (ingresso SG→SG) e o `request_scaling_target_ref` que ativa a
   terceira política de escala.

## O que o stack precisa passar para a task SUBIR (e não morrer calada)

- `environment` — `AUTH_MODE=cognito` + `COGNITO_*`. `resolverConfigAuth` é **fail-closed**
  (P-91): sem isso o processo **aborta no boot**, e o apply sai 0 do mesmo jeito.
- `extra_secret_refs` — `ANTHROPIC_API_KEY`. Sem ela, `iniciarWorkers()` devolve `null` e a
  metade **triagem-pool** do tier fica inerte (o BFF sobe; o worker, não).
- `NODE_ENV` é derivado aqui (`dev` → `development`, resto → `production`) — é contrato do
  runtime e do guarda de P-91, **não** o nome do ambiente.

## Bedrock batch inference (P-92/RAD-231/RAD-236)

`bedrock_batch_service_role_ref`/`batch_bucket_ref` nulos (default) = sem policy nenhuma —
mesmo padrão de `queue_refs` vazio. Quando o stack passa os dois (saída do módulo
`storage`), a TASK role ganha exatamente: submeter/monitorar o job
(`CreateModelInvocationJob`/`Get`/`Stop`, escopado a `model-invocation-job/*` +
`inference-profile/*` desta conta + `foundation-model/anthropic.*` — nunca `Resource: "*"`),
`iam:PassRole` restrito à **única** role de serviço do Bedrock (`iam:PassedToService`
trava o destino — sem isto, `PassRole` amplo é escalonamento de privilégio), e
`s3:PutObject`/`GetObject` nos prefixos `batch/input/`/`batch/output/` do bucket dedicado
(não o de anexos). Detalhe da service role (trust policy, S3/KMS/InvokeModel) fica no
README do módulo `storage`, que é quem a possui.
