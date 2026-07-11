# Módulo: vpc
# Rede privada isolada com sub-redes públicas (gateway/WAF) e privadas (compute/DB).
# Binding hoje = AWS VPC. Contrato usa `network_cidr`/`network_id` (neutros);
# recursos internos idênticos ao original para garantir paridade de estado.
# Refs: arquitetura/08 §§4,11; docs/98 P-28; RAD-181/RAD-182

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
  }

  # Nunca mais gateway de saída do que AZ (o gateway vive numa sub-rede pública, uma por AZ).
  nat_count = min(var.egress_gateway_count, length(var.availability_zones))

  # Sempre >= 1 route table PRIVADA explícita, mesmo sem saída: sem associação, a sub-rede cai
  # na main route table — e o endpoint de object storage (que é uma ROTA) não teria onde entrar.
  private_rt_count = max(local.nat_count, 1)
}

resource "aws_vpc" "this" {
  cidr_block           = var.network_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.tags, { Name = "${var.project}-${var.env}-vpc" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.project}-${var.env}-igw" })
}

resource "aws_subnet" "public" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.network_cidr, 8, count.index)
  availability_zone = var.availability_zones[count.index]

  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = "${var.project}-${var.env}-public-${count.index}" })
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.network_cidr, 8, count.index + 10)
  availability_zone = var.availability_zones[count.index]

  tags = merge(local.tags, { Name = "${var.project}-${var.env}-private-${count.index}" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(local.tags, { Name = "${var.project}-${var.env}-rt-public" })
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# --- Saída da sub-rede privada (RAD-199) ----------------------------------------------
# Ver variables.tf para o porquê de NAT ser obrigatório (PNCP/LLM = destino público).
# GUARDRAIL PRESERVADO: a saída é UNIDIRECIONAL — o NAT vive na sub-rede PÚBLICA e não dá
# rota de ENTRADA para a privada. Sub-rede privada segue sem IP público (`assign_public_ip
# = false` nas tasks) e o banco segue proxy-only.

resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"

  tags = merge(local.tags, { Name = "${var.project}-${var.env}-eip-nat-${count.index}" })
}

resource "aws_nat_gateway" "this" {
  count         = local.nat_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = merge(local.tags, { Name = "${var.project}-${var.env}-nat-${count.index}" })

  # Sem IGW anexado, o NAT sobe mas não roteia. Dependência implícita não existe aqui.
  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  count  = local.private_rt_count

  # `nat_count == 0` => route table sem rota default: privada continua local-only (estado
  # anterior a RAD-199), mas agora EXPLÍCITO em vez de herdado da main route table.
  dynamic "route" {
    for_each = local.nat_count == 0 ? [] : [aws_nat_gateway.this[count.index].id]
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = route.value
    }
  }

  tags = merge(local.tags, { Name = "${var.project}-${var.env}-rt-private-${count.index}" })
}

# Com um NAT por AZ, a sub-rede i sai pelo NAT da PRÓPRIA AZ (índice casado): sem travessia
# de AZ (que seria cobrada) e sem acoplar a saída de uma AZ à saúde de outra. Com NAT único,
# todas caem na mesma route table.
resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index % local.private_rt_count].id
}

# Endpoint de object storage (Gateway) — GRÁTIS e é rota, não ENI. As camadas de imagem do
# ECR são servidas de object storage: sem isto, todo pull de task fria atravessa o NAT e paga
# processamento por GB. Vale mesmo com `egress_gateway_count = 0`.
resource "aws_vpc_endpoint" "object_storage" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = merge(local.tags, { Name = "${var.project}-${var.env}-vpce-s3" })
}
