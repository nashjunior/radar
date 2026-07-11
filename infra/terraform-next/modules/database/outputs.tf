# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "cluster_endpoint" {
  description = "Endpoint de escrita do banco (portável)"
  value       = aws_rds_cluster.this.endpoint
}

output "reader_endpoint" {
  description = "Endpoint de leitura do banco (portável)"
  value       = aws_rds_cluster.this.reader_endpoint
}

output "cluster_ref" {
  description = "Handle do cluster que o proxy fronteia. AWS: Aurora cluster_identifier"
  value       = aws_rds_cluster.this.cluster_identifier
}

output "firewall_group_ref" {
  description = "Grupo de firewall do banco — o proxy anexa ingress 5432 aqui. AWS: Security Group id"
  value       = aws_security_group.db.id
}

output "parameter_group_name" {
  description = "Grupo de parâmetros com os pisos de pool/timeout/work_mem (P-41). Provider-bound (RDS)"
  value       = aws_db_parameter_group.this.name
}

output "max_connections" {
  description = "max_connections efetivo do banco — base do cálculo de backends por pool (P-41)"
  value       = var.max_connections
}
