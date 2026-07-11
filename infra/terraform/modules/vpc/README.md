# Módulo `vpc` — rede privada isolada (RAD-181/RAD-182)

Rede com sub-redes públicas (gateway/WAF) e privadas (compute/DB). Contrato neutro:
`network_cidr`/`network_id`; binding hoje = AWS VPC.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Bloco de endereços | `network_cidr` (string CIDR) | VPC CIDR |
| ID da rede | `network_id` | VPC id |
| Sub-redes privadas | `private_subnet_ids` | Subnet ids |
| Sub-redes públicas | `public_subnet_ids` | Subnet ids |
| Zonas de disponibilidade | `availability_zones` | AZ names |

## O que é provider-bound (custo real de exit → GCP/Azure)

- **Internet Gateway + Route Table** — em GCP é implícito na VPC (sem IGW separado); em
  Azure usa UDR/Internet Route. Semântica similar, recursos diferentes.
- **`map_public_ip_on_launch`** — atributo de subnet AWS; em GCP/Azure a topologia pública
  se configura por access config/SKU na NIC da VM, não na subnet.
- **`enable_dns_hostnames` / `enable_dns_support`** — atributos AWS; em GCP DNS interno é
  habilitado por default; em Azure configurado no profile DNS da VNET.
- **`cidrsubnet` offset 10 para privadas** — convenção de CIDR deste projeto; portável como
  regra, mas implementação muda no `main.tf` de cada provedor.

## Saída da sub-rede privada (RAD-199)

Até RAD-199 a sub-rede privada **não tinha rota de saída**: nenhuma route table associada, ela
caía na main route table (local-only). Consequência silenciosa: task de Fargate ali não puxa
imagem do registro nem lê segredo no cofre — e o `apply` **sai 0 mesmo assim**.

- **NAT é obrigatório, não uma das duas opções.** O tier sempre-ligado faz o polling do PNCP
  (`pncp.gov.br`) e a chamada ao LLM — **destinos públicos, sem PrivateLink**. VPC endpoint só
  cobre serviço AWS; sozinho, deixaria a ingestão sem fonte.
- **Endpoint de object storage (Gateway)** entra sempre: é **grátis** e as camadas de imagem do
  ECR vêm de lá — sem ele, todo pull de task fria atravessa o NAT e paga por GB.
- **Interface endpoints** (ecr.api, ecr.dkr, secretsmanager, logs, sqs, kms) seguem possíveis
  **como otimização sobre o NAT** (~US$ 7/mês cada, por AZ). Não fecham a saída pública, logo
  **não substituem a allowlist de egress** (P-58 — hoje garantida no código pelo `SsrfGuard`).
- **Guardrail preservado:** a saída é **unidirecional**. O NAT vive na sub-rede pública e não
  cria rota de entrada; a task continua sem IP público e o banco, proxy-only.
- `egress_gateway_count`: **um por AZ em prod** (a queda da AZ de um NAT único pararia
  ingestão, triagem e boot de task nova nas outras); **um só** fora de prod (~US$ 32/mês cada).
