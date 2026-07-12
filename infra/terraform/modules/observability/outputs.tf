# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.
# Binding = CloudWatch (alarmes + dashboard) — documentado no README.

output "alarm_refs" {
  description = "Mapa SLO -> handle do alarme. AWS: CloudWatch alarm ARN"
  value = {
    frescor_alerta                  = aws_cloudwatch_metric_alarm.frescor_alerta.arn
    entrega_imediata                = aws_cloudwatch_metric_alarm.entrega_imediata.arn
    triagem_latencia                = aws_cloudwatch_metric_alarm.triagem_latencia.arn
    caminho_critico_disponibilidade = aws_cloudwatch_metric_alarm.caminho_critico_disponibilidade.arn
    prazo_critico_perdido           = aws_cloudwatch_metric_alarm.prazo_critico_perdido.arn
  }
}

output "dashboard_ref" {
  description = "Handle do dashboard dos 5 SLOs. AWS: CloudWatch dashboard ARN"
  value       = aws_cloudwatch_dashboard.slo.dashboard_arn
}
