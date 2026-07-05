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
