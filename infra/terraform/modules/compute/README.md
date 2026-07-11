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

## Pré-requisitos (por que este módulo AINDA NÃO está wireado em nenhum stack)

O módulo está escrito e validado, mas **de propósito não é instanciado** — instanciá-lo hoje
criaria um serviço cujas tasks nunca sobem, e o `apply` sairia **0** assim mesmo (ECS não
falha o apply quando a task morre no boot; o serviço só fica com 0 task sã). Falta:

1. **Rota de saída da sub-rede privada.** O módulo `vpc` cria as sub-redes privadas mas não
   cria NAT nem VPC endpoint, e não associa route table — elas caem na main route table
   (local-only). Sem isso a task não puxa a imagem do ECR nem lê o segredo no Secrets
   Manager. (Vale também para o RDS Proxy, que busca credencial no Secrets Manager.)
2. **Imagem do container.** Não há Dockerfile no repo nem repositório ECR na IaC;
   `container_image_uri` não teria o que apontar.
3. **Borda (ingress).** Não existe ALB/API Gateway na IaC e a decisão é **P-55** (aberta;
   A08 §5 desenha "API Gateway / WAF"). Sem borda o serviço processa fila mas não serve HTTP
   — e a política de escala por requisição (`request_scaling_target_ref`) fica inativa.

Esses três pré-requisitos são **RAD-199**, que é quem wirea este módulo. Autoscaling por
CPU/memória e as policies de IAM já estão prontas aqui e passam a valer no mesmo apply.
