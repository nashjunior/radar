output "cluster_endpoint" {
  description = "Endpoint de escrita do cluster Aurora"
  value       = aws_rds_cluster.this.endpoint
}

output "reader_endpoint" {
  description = "Endpoint de leitura do cluster Aurora"
  value       = aws_rds_cluster.this.reader_endpoint
}

output "cluster_id" {
  description = "Identifier do cluster"
  value       = aws_rds_cluster.this.cluster_identifier
}

output "security_group_id" {
  description = "Security Group do banco"
  value       = aws_security_group.db.id
}

output "parameter_group_name" {
  description = "DB parameter group com os pisos de pool/timeout/work_mem (P-41)"
  value       = aws_db_parameter_group.this.name
}

output "max_connections" {
  description = "max_connections efetivo do banco — base do cálculo de backends por pool (P-41)"
  value       = var.max_connections
}
