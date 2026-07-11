# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "bucket_name" {
  description = "Nome do bucket de objetos (portável — usado em SDK/CLI)"
  value       = aws_s3_bucket.anexos.bucket
}

output "bucket_ref" {
  description = "Handle do bucket (policies IAM/permissões). AWS: S3 bucket ARN"
  value       = aws_s3_bucket.anexos.arn
}
