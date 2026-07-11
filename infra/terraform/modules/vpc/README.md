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
