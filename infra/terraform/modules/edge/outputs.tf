# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "firewall_group_ref" {
  description = "Grupo de firewall da borda — o compute abre ingresso da porta do container SÓ para cá. AWS: Security Group id"
  value       = aws_security_group.edge.id
}

output "target_group_ref" {
  description = "Handle do alvo que recebe as tasks — vai no `target_group_ref` do compute. AWS: ALB target group ARN"
  value       = aws_lb_target_group.this.arn
}

# Destrava a TERCEIRA política de escala do compute (RAD-192): a métrica por requisição exige
# este identificador composto, e é o único motivo de o seam existir nulo até agora (P-55).
output "request_scaling_target_ref" {
  description = "Handle do alvo de escala por requisição. Provider-bound: AWS exige o resource label app/<lb>/<id>/targetgroup/<tg>/<id>."
  value       = "${aws_lb.this.arn_suffix}/${aws_lb_target_group.this.arn_suffix}"
}

output "public_hostname" {
  description = "Hostname público da borda — origem do front (VITE_API_URL) e destino do DNS (portável)"
  value       = aws_lb.this.dns_name
}

output "edge_ref" {
  description = "Handle da borda. AWS: ALB ARN"
  value       = aws_lb.this.arn
}
