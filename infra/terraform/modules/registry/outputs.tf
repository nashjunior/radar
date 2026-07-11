# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "repository_uri" {
  description = "URI da imagem SEM tag — vai direto no `container_image_uri` do compute e no `docker push` do CI (portável: é uma URI OCI)"
  value       = aws_ecr_repository.this.repository_url
}

output "repository_ref" {
  description = "Handle do repositório. AWS: ECR repository ARN"
  value       = aws_ecr_repository.this.arn
}
