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
