# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.
# Binding = ECS/Fargate — documentado no README.

output "cluster_ref" {
  description = "Handle do cluster de containers. AWS: ECS cluster ARN"
  value       = aws_ecs_cluster.this.arn
}

output "task_def_ref" {
  description = "Handle da task definition ativa. AWS: ECS task definition ARN"
  value       = aws_ecs_task_definition.api.arn
}

output "task_role_ref" {
  description = "Handle da role de execução da task. AWS: IAM role ARN"
  value       = aws_iam_role.ecs_task.arn
}

output "cluster_name" {
  description = "Nome do ECS cluster. Binding: aws_ecs_cluster.name"
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "Nome do ECS service. Binding: aws_ecs_service.api.name"
  value       = aws_ecs_service.api.name
}
