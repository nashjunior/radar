# Estado remoto — S3 + DynamoDB lock (P-65)
# BLOQUEADO: requer conta AWS provisionada (owner: nash junior / operador).
# Scaffold presente; plan/apply diferidos até a conta existir.

terraform {
  backend "s3" {
    bucket         = "radar-tf-state-dev"
    key            = "dev/terraform.tfstate"
    region         = "sa-east-1"
    encrypt        = true
    dynamodb_table = "radar-tf-lock"
  }
}
