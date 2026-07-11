# Módulo: edge
# Borda HTTP pública do tier sempre-ligado. Binding hoje = AWS ALB (Application Load Balancer).
#
# P-55 (ALB vs. API Gateway) decidida em RAD-199: **ALB**. O raciocínio, curto:
#   1. O serviço roda em sub-rede PRIVADA. API Gateway com integração privada exige VPC Link,
#      que exige um balanceador (ALB/NLB) atrás dele de qualquer jeito — o gateway seria custo
#      SOMADO, não alternativa.
#   2. O WAF de P-55 não anexa em HTTP API (v2). Sobraria REST API (mais caro por requisição)
#      + VPC Link + NLB — três peças para chegar onde o ALB chega sozinho.
#   3. O que o API Gateway traz de único (authorizer JWT nativo, usage plan por API key) o
#      Radar não usa: o JWT é validado na aplicação (`jose`, P-08/P-91) e o rate-limit por
#      tenant depende do claim já verificado — nem gateway nem WAF fazem isso (ver `waf`).
#   4. O módulo `compute` já tinha o seam esperando um ALB: a política de escala por requisição
#      é `ALBRequestCountPerTarget`, cujo resource label sai daqui (`request_scaling_target_ref`).
# Reabre se aparecer necessidade de monetização por API key, throttling por plano ou exposição
# de API pública a terceiros — nada disso está no MVP-Now.
#
# Refs: arquitetura/08 §5; docs/98 P-55/P-08; RAD-199

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
}

resource "aws_security_group" "edge" {
  name        = "${var.project}-${var.env}-edge-sg"
  description = "Borda HTTP publica: unico ponto de ingresso da rede"
  vpc_id      = var.network_id

  tags = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  count = length(var.allowed_ingress_cidrs)

  security_group_id = aws_security_group.edge.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = var.allowed_ingress_cidrs[count.index]
  description       = "HTTPS publico"
}

# 80 existe só para redirecionar a 443 quando há certificado (ninguém digita https://).
# Sem certificado (dev), 80 é o ÚNICO caminho — e é por isso que prod exige certificado.
resource "aws_vpc_security_group_ingress_rule" "http" {
  count = length(var.allowed_ingress_cidrs)

  security_group_id = aws_security_group.edge.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = var.allowed_ingress_cidrs[count.index]
  description       = "HTTP publico (redireciona a HTTPS quando ha certificado)"
}

# Egress ESCOPADO na porta do container e no CIDR da rede — não `0.0.0.0/0`. A borda é o
# recurso mais exposto da topologia: se for comprometida, ela só alcança a porta da task.
# Não referencio o SG das tasks (que vive no `compute`) porque isso criaria ciclo entre os
# dois módulos; o lado APERTADO do par (SG→SG) fica no `compute`, no ingresso.
resource "aws_vpc_security_group_egress_rule" "to_tasks" {
  security_group_id = aws_security_group.edge.id
  ip_protocol       = "tcp"
  from_port         = var.target_port
  to_port           = var.target_port
  cidr_ipv4         = var.network_cidr
  description       = "Somente a porta do container, somente dentro da rede"
}

resource "aws_lb" "this" {
  name               = "${var.project}-${var.env}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.edge.id]

  # Header HTTP malformado é vetor de request smuggling — a borda derruba, não repassa.
  drop_invalid_header_fields = true

  enable_deletion_protection = var.env == "prod"
  idle_timeout               = var.idle_timeout_seconds

  tags = local.tags

  lifecycle {
    precondition {
      condition     = var.env != "prod" || var.certificate_ref != null
      error_message = "prod sem certificado publicaria a API em HTTP puro — TLS é baseline (A08 §5, docs/05 §4)."
    }
  }
}

resource "aws_lb_target_group" "this" {
  name        = "${var.project}-${var.env}-tg"
  port        = var.target_port
  protocol    = "HTTP"
  vpc_id      = var.network_id
  target_type = "ip" # awsvpc/Fargate: o alvo é o ENI da task, não uma instância

  health_check {
    path                = var.health_check_path
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Task derrubada em scale-in continua servindo o que já aceitou; 30 s cobre a requisição em
  # voo sem segurar o deploy.
  deregistration_delay = 30

  tags = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  # Com certificado: 80 só redireciona. Sem: 80 serve (dev — TLS termina em nada).
  dynamic "default_action" {
    for_each = var.certificate_ref == null ? [] : [1]
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = var.certificate_ref == null ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.this.arn
    }
  }
}

resource "aws_lb_listener" "https" {
  count = var.certificate_ref == null ? 0 : 1

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = var.tls_policy
  certificate_arn   = var.certificate_ref

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

# A associação mora aqui (a ACL é 1:N — pode proteger outras bordas), mas o handle vem do
# stack: `waf` e `edge` são primitivas irmãs, nenhuma importa a outra (A08 §1).
resource "aws_wafv2_web_acl_association" "this" {
  count = var.web_acl_ref == null ? 0 : 1

  resource_arn = aws_lb.this.arn
  web_acl_arn  = var.web_acl_ref
}
