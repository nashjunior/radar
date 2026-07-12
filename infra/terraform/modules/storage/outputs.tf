# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "bucket_name" {
  description = "Nome do bucket de objetos (portável — usado em SDK/CLI)"
  value       = aws_s3_bucket.anexos.bucket
}

output "bucket_ref" {
  description = "Handle do bucket (policies IAM/permissões). AWS: S3 bucket ARN"
  value       = aws_s3_bucket.anexos.arn
}

output "batch_input_ref" {
  description = "URI do prefixo de entrada do batch inference do Bedrock (P-92). AWS: S3 URI"
  value       = "s3://${aws_s3_bucket.batch.bucket}/batch/input/"
}

output "batch_output_ref" {
  description = "URI do prefixo de saída do batch inference do Bedrock (P-92). AWS: S3 URI"
  value       = "s3://${aws_s3_bucket.batch.bucket}/batch/output/"
}

output "batch_service_role_ref" {
  description = "Handle da role que o Bedrock assume para ler/escrever o batch (P-92). AWS: IAM role ARN"
  value       = aws_iam_role.bedrock_batch.arn
}

output "batch_bucket_ref" {
  description = "Handle do bucket de I/O do batch (escopa a policy do worker que submete o job, módulo compute). AWS: S3 bucket ARN"
  value       = aws_s3_bucket.batch.arn
}
