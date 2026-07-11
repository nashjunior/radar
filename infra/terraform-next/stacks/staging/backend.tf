# Estado remoto — S3 + DynamoDB lock (P-65)
# backend.tf = MESMO bucket/lock/key do stack atual — plan do -next enxerga o estado real.

terraform {
  backend "s3" {
    bucket         = "radar-tf-state-staging"
    key            = "staging/terraform.tfstate"
    region         = "sa-east-1"
    encrypt        = true
    dynamodb_table = "radar-tf-lock"
  }
}
