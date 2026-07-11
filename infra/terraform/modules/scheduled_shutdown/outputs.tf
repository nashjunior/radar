output "scheduler_role_arn" {
  description = "ARN da IAM role usada pelos schedules"
  value       = aws_iam_role.scheduler.arn
}

output "schedule_group_name" {
  description = "Nome do schedule group (útil para visibilidade no console)"
  value       = aws_scheduler_schedule_group.shutdown.name
}
