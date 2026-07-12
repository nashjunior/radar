# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "queue_url" {
  description = "URL de acesso à fila (portável — usada pelo publisher/consumer)"
  value       = aws_sqs_queue.this.url
}

output "queue_ref" {
  description = "Handle da fila (producer/consumer policies). AWS: SQS queue ARN"
  value       = aws_sqs_queue.this.arn
}

output "dlq_ref" {
  description = "Handle da fila de dead-letter. AWS: SQS DLQ ARN"
  value       = aws_sqs_queue.dlq.arn
}

# Pass-through do input — single source of truth para o stack injetar na app (RAD-321): o
# consumidor precisa comparar `ApproximateReceiveCount` contra este número para saber que é a
# ÚLTIMA entrega antes da DLQ (compensação `triagem.falhou`, A03 §3.1). Sem isto o stack
# duplicaria o literal em dois lugares (aqui e no `environment` do `compute`) e os dois podem
# divergir silenciosamente.
output "max_receive_count" {
  description = "Tentativas antes da DLQ — a app lê via env var para detectar a última entrega"
  value       = var.max_receive_count
}
