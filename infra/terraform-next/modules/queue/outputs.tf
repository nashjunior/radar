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
