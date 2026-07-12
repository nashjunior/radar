# Módulo `observability` — detecção sobre os SLOs (contrato neutro, RAD-300 story 4/5)

Primitiva A18 §5 "Alarmes CloudWatch, dashboard, metric filters, tracing backend". **Contrato**
neutro; **implementação** = CloudWatch Alarms + Dashboard sobre métricas EMF publicadas no
namespace `Radar/SLO` (arquitetura/18 §5, RAD-302/RAD-303). Este módulo **consome** a métrica —
não emite (`PutMetricData` no caminho quente foi deliberadamente descartado, arquitetura/18 §5).

## Contrato (não vaza AWS)

| Input | Conceito | AWS |
|---|---|---|
| `project`, `env`, `region` | prefixo/ambiente/região (`ambiente` = dimensão do contrato EMF) | tag, dimensão de métrica |
| `alarm_topic_ref` | destino da ação do alarme (vazio = só métrica/dashboard) | SNS topic ARN |
| `frescor_alerta_ms_threshold`, `entrega_imediata_ms_threshold`, `triagem_ms_threshold`, `disponibilidade_percentual_minimo`, `prazo_critico_perdido_threshold`, `prazo_critico_ciclo_falhou_threshold` | limiares duros dos 5 SLOs (docs/08 §4.1) | valor de alarme CloudWatch |

| Output | Conceito | AWS |
|---|---|---|
| `alarm_refs` | mapa SLO → handle do alarme | CloudWatch alarm ARN |
| `dashboard_ref` | handle do dashboard | CloudWatch dashboard ARN |

## Por que não há `aws_cloudwatch_log_metric_filter`

EMF (Embedded Metric Format) não é extraído por metric filter — é um recurso **diferente**,
que só serve para achar padrão em log de texto livre. Um log event no formato EMF (bloco
`_aws.CloudWatchMetrics`) escrito em **qualquer** log group já é extraído automaticamente pelo
CloudWatch, sem declarar nada em Terraform. Os log groups da API (`compute/main.tf`,
`aws_cloudwatch_log_group.api`) e do worker (`serverless/main.tf`,
`aws_cloudwatch_log_group.worker`) já existem e já têm a permissão de escrita que o log
estruturado comum usa — nada de IAM novo. Se um dia o app deixar de emitir EMF e passar a
escrever texto que precise de parsing, aí sim entra `aws_cloudwatch_log_metric_filter` — não é
o caso hoje (arquitetura/18 §5).

## PRESERVAR — o que este módulo não pode perder

- **`alerta.prazo_critico.perdido` e `alerta.prazo_critico.ciclo.falhou` sem `treat_missing_data`**
  — o default `missing` mantém os dois alarmes em `INSUFFICIENT_DATA` até o reconciliador
  (RAD-303) existir/rodar. Isso é intencional (arquitetura/18 §5.1): alarme ausente mentiria
  que a categoria "prazo crítico" está coberta. **Não** adicionar `treat_missing_data =
  "notBreaching"` neles achando que "conserta" o estado. São **irmãos, não substitutos**:
  `perdido` mede déficit apurado (o ciclo terminou e contou), `ciclo.falhou` mede incapacidade
  de apurar (o ciclo lançou antes de publicar o evento, RAD-332/RAD-333) — sem o segundo, um
  reconciliador que nunca completa fica indistinguível de "nunca rodou".
- **`pipeline.ciclo.falhou` soma no `total` de `caminho_critico_disponibilidade`** — um ciclo
  do `PncpPollingScheduler` que lança antes de publicar `pipeline.ciclo.concluido` não
  incrementa `ok` nem `erro`; sem somar em `total`, esse ciclo é invisível e, no caso limite
  (`total == 0`), a fórmula lê o pior caso como 100% de disponibilidade.
- **`Radar/SLO` / dimensão `ambiente`** é o contrato publicado por A18 §5 — mudar o namespace
  ou o nome da dimensão aqui sem mudar no assinante do app quebra os alarmes em silêncio
  (ficam `INSUFFICIENT_DATA` para sempre, sem erro de `plan`/`apply`).
- **Nenhum limiar de warning** — só os duros de docs/08 §4.1. Os de warning (antes do estouro
  do budget mensal) são `[A VALIDAR]` em P-111 até existir baseline com tráfego real
  (arquitetura/18 §8); não estimar aqui.

## Custo real de um exit

CloudWatch Alarms + Dashboard não têm equivalente 1:1 fora da AWS — GCP usa Cloud Monitoring
Alerting Policies (MQL em vez de metric math), Azure usa Monitor Alerts (KQL). A troca de
provedor reescreve as 6 expressões de alarme e o JSON do dashboard inteiros; o que sobrevive
é o contrato (`Radar/SLO`, dimensão `ambiente`, os nomes de métrica) porque vive no app, não
aqui. Portabilidade aqui é **documentar o custo**, não fingir neutralidade que não existe.
