# Módulo: observability
# Detecção sobre os SLOs de docs/08 §4.1 (A18 §5, P-111, RAD-300 story 4/5). Consome o que o
# assinante evento→EMF do app publica (RAD-302) — não faz PutMetricData, não instrumenta
# use case. Um alarme por SLO + dashboard. Bloqueado, por natureza, pelas stories 1-3 do
# RAD-300 no que toca dado real; os alarmes existem hoje mesmo assim (INSUFFICIENT_DATA
# honesto — ver o de prazo crítico abaixo — é o estado correto, alarme ausente não é).
#
# Sobre (a) "metric filters" do EMF: EMF não usa aws_cloudwatch_log_metric_filter. O
# CloudWatch extrai a métrica automaticamente de QUALQUER log event no formato EMF
# (bloco `_aws.CloudWatchMetrics`) escrito num log group — não há recurso de extração a
# declarar, e os log groups da API (compute/main.tf) e do worker (serverless/main.tf) já
# existem e já recebem write permission via a mesma role/driver do log estruturado comum.
# Metric filter (recurso diferente) só seria necessário se o app emitisse texto livre em
# vez de EMF — não é o caso (arquitetura/18 §5).
#
# CONTRATO neutro (variables/outputs) · IMPLEMENTAÇÃO provider-bound (este main.tf).
# Refs: arquitetura/18 §5, docs/08 §4.1 (P-36), docs/98 P-111.

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

  # Contrato fixo do assinante evento→EMF (arquitetura/18 §5) — não é knob de ambiente.
  namespace = "Radar/SLO"

  alarm_actions = var.alarm_topic_ref == "" ? [] : [var.alarm_topic_ref]
}

# --- SLO 1: Frescor do alerta padrão (p95 ≤ 30 min, budget 5%/mês) ---------------------

resource "aws_cloudwatch_metric_alarm" "frescor_alerta" {
  alarm_name          = "${var.project}-${var.env}-slo-frescor-alerta"
  namespace           = local.namespace
  metric_name         = "alerta.frescor_ms"
  dimensions          = { ambiente = var.env }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.frescor_alerta_ms_threshold
  treat_missing_data  = "notBreaching"
  alarm_description   = "p95 publicação PNCP -> alerta.gerado acima de ${var.frescor_alerta_ms_threshold}ms (docs/08 §4.1)"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = merge(local.tags, { slo = "frescor-alerta" })
}

# --- SLO 2: Entrega imediata (p95 ≤ 5 min, dim imediato=true, budget 5%/mês) -----------

resource "aws_cloudwatch_metric_alarm" "entrega_imediata" {
  alarm_name          = "${var.project}-${var.env}-slo-entrega-imediata"
  namespace           = local.namespace
  metric_name         = "notificacao.latencia_entrega_ms"
  dimensions          = { ambiente = var.env, imediato = "true" }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.entrega_imediata_ms_threshold
  treat_missing_data  = "notBreaching"
  alarm_description   = "p95 alerta.gerado -> notificacao.enviada (imediato) acima de ${var.entrega_imediata_ms_threshold}ms (docs/08 §4.1; não usa o budget de prazo crítico)"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = merge(local.tags, { slo = "entrega-imediata" })
}

# --- SLO 3: Triagem solicitada (p95 ≤ 3 min, budget 5%/mês) ----------------------------

resource "aws_cloudwatch_metric_alarm" "triagem_latencia" {
  alarm_name          = "${var.project}-${var.env}-slo-triagem-latencia"
  namespace           = local.namespace
  metric_name         = "triagem.latencia_ms"
  dimensions          = { ambiente = var.env }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.triagem_ms_threshold
  treat_missing_data  = "notBreaching"
  alarm_description   = "p95 triagem.solicitada -> triagem.concluida acima de ${var.triagem_ms_threshold}ms (docs/08 §4.1; degrada triagem antes de ingestão/matching/alerta)"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = merge(local.tags, { slo = "triagem-latencia" })
}

# --- SLO 4: Caminho crítico ingestão -> alerta (disponibilidade >= 99,5%/mês) ----------
# Disponibilidade = ok / (ok + erro + 5xx). FILL(...,0) trata ausência de dado como "não
# rodou nada" (não como indisponibilidade) — e treat_missing_data é o backstop caso a
# métrica ainda não exista (pré-RAD-302).

resource "aws_cloudwatch_metric_alarm" "caminho_critico_disponibilidade" {
  alarm_name          = "${var.project}-${var.env}-slo-caminho-critico-disponibilidade"
  comparison_operator = "LessThanThreshold"
  threshold           = var.disponibilidade_percentual_minimo
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"
  alarm_description   = "Disponibilidade do caminho crítico ingestão->alerta abaixo de ${var.disponibilidade_percentual_minimo}% (docs/08 §4.1; budget mensal 0,5%)"

  metric_query {
    id          = "ok"
    return_data = false
    metric {
      metric_name = "pipeline.ciclo.ok"
      namespace   = local.namespace
      period      = 300
      stat        = "Sum"
      dimensions  = { ambiente = var.env }
    }
  }

  metric_query {
    id          = "erro"
    return_data = false
    metric {
      metric_name = "pipeline.ciclo.erro"
      namespace   = local.namespace
      period      = 300
      stat        = "Sum"
      dimensions  = { ambiente = var.env }
    }
  }

  metric_query {
    id          = "erro5xx"
    return_data = false
    metric {
      metric_name = "api.5xx"
      namespace   = local.namespace
      period      = 300
      stat        = "Sum"
      dimensions  = { ambiente = var.env }
    }
  }

  metric_query {
    id          = "total"
    expression  = "FILL(ok,0) + FILL(erro,0) + FILL(erro5xx,0)"
    label       = "Total de ciclos"
    return_data = false
  }

  metric_query {
    id          = "disponibilidade"
    expression  = "IF(total == 0, 100, 100 * FILL(ok,0) / total)"
    label       = "Disponibilidade (%)"
    return_data = true
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = merge(local.tags, { slo = "caminho-critico" })
}

# --- SLO 5: Alerta de prazo crítico perdido — ERROR BUDGET ZERO ------------------------
# Categoricamente diferente (arquitetura/18 §5.1): não é alarme de página, é o gatilho do
# procedimento de P-36/P-35. Existe mesmo sem o reconciliador (RAD-303) — SEM
# treat_missing_data, o default "missing" deixa o alarme em INSUFFICIENT_DATA até a métrica
# nascer. É o estado honesto; alarme ausente mentiria que a categoria está coberta.

resource "aws_cloudwatch_metric_alarm" "prazo_critico_perdido" {
  alarm_name          = "${var.project}-${var.env}-slo-prazo-critico-perdido-severidade-maxima"
  namespace           = local.namespace
  metric_name         = "alerta.prazo_critico.perdido"
  dimensions          = { ambiente = var.env }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.prazo_critico_perdido_threshold
  alarm_description   = "ERROR BUDGET ZERO (docs/08 §4.1): qualquer alerta de prazo crítico perdido bloqueia release externo/expansão até RCA + replay comprovados (P-36/P-35). INSUFFICIENT_DATA até o reconciliador (RAD-303) existir é esperado, não é ausência de cobertura."

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = merge(local.tags, { slo = "prazo-critico-perdido", severidade = "maxima" })
}

# --- Dashboard: os 5 SLOs num só lugar --------------------------------------------------

resource "aws_cloudwatch_dashboard" "slo" {
  dashboard_name = "${var.project}-${var.env}-slo"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "Frescor do alerta (p95 ms)"
          region = var.region
          view   = "timeSeries"
          metrics = [
            ["Radar/SLO", "alerta.frescor_ms", "ambiente", var.env, { stat = "p95", label = "p95 frescor" }]
          ]
          annotations = {
            horizontal = [{ label = "SLO 30 min", value = var.frescor_alerta_ms_threshold }]
          }
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "Entrega imediata (p95 ms)"
          region = var.region
          view   = "timeSeries"
          metrics = [
            ["Radar/SLO", "notificacao.latencia_entrega_ms", "ambiente", var.env, "imediato", "true", { stat = "p95", label = "p95 entrega imediata" }]
          ]
          annotations = {
            horizontal = [{ label = "SLO 5 min", value = var.entrega_imediata_ms_threshold }]
          }
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "Triagem (p95 ms)"
          region = var.region
          view   = "timeSeries"
          metrics = [
            ["Radar/SLO", "triagem.latencia_ms", "ambiente", var.env, { stat = "p95", label = "p95 triagem" }]
          ]
          annotations = {
            horizontal = [{ label = "SLO 3 min", value = var.triagem_ms_threshold }]
          }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Caminho crítico ingestão -> alerta (disponibilidade %)"
          region = var.region
          view   = "timeSeries"
          metrics = [
            ["Radar/SLO", "pipeline.ciclo.ok", "ambiente", var.env, { id = "ok", visible = false, stat = "Sum" }],
            ["Radar/SLO", "pipeline.ciclo.erro", "ambiente", var.env, { id = "erro", visible = false, stat = "Sum" }],
            ["Radar/SLO", "api.5xx", "ambiente", var.env, { id = "erro5xx", visible = false, stat = "Sum" }],
            [{ expression = "FILL(ok,0)+FILL(erro,0)+FILL(erro5xx,0)", id = "total", visible = false, label = "Total" }],
            [{ expression = "IF(total==0,100,100*FILL(ok,0)/total)", id = "disponibilidade", label = "Disponibilidade (%)" }]
          ]
          annotations = {
            horizontal = [{ label = "SLO 99,5%", value = var.disponibilidade_percentual_minimo }]
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title                = "Alerta de prazo crítico — elegível / coberto / perdido"
          region               = var.region
          view                 = "singleValue"
          setPeriodToTimeRange = true
          sparkline            = true
          metrics = [
            ["Radar/SLO", "alerta.prazo_critico.elegivel", "ambiente", var.env, { stat = "Sum", label = "Elegíveis" }],
            ["Radar/SLO", "alerta.prazo_critico.coberto", "ambiente", var.env, { stat = "Sum", label = "Cobertos" }],
            ["Radar/SLO", "alerta.prazo_critico.perdido", "ambiente", var.env, { stat = "Sum", label = "Perdidos", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "text"
        x      = 0
        y      = 12
        width  = 24
        height = 3
        properties = {
          markdown = "**Limiares de warning** (antes do estouro do error budget mensal de cada SLO) ficam `[A VALIDAR]` em P-111 — dependem de baseline com tráfego real; só os limiares duros de docs/08 §4.1 estão alarmados. **Disponibilidade** aqui é a leitura operacional (janela de 15 min por trás do alarme); o consumo real do budget mensal (0,5%) é apuração de negócio, não este widget."
        }
      }
    ]
  })
}
