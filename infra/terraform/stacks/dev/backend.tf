# Estado remoto — S3 + DynamoDB lock (P-65)
# BLOQUEADO: requer conta AWS provisionada (owner: DevOps/Artur).
# Scaffold presente; plan/apply diferidos até a conta existir.
# backend.tf = MESMO bucket/lock/key do stack atual — plan do -next enxerga o estado real.

terraform {
  backend "s3" {
    bucket         = "radar-tf-state-dev"
    key            = "dev/terraform.tfstate"
    region         = "sa-east-1"
    encrypt        = true
    dynamodb_table = "radar-tf-lock"
  }
}
