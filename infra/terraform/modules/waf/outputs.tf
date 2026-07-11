# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "web_acl_ref" {
  description = "Handle da ACL de firewall L7 — o stack associa à borda. AWS: WAFv2 Web ACL ARN"
  value       = aws_wafv2_web_acl.this.arn
}
