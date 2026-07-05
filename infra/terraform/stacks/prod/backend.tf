terraform {
  backend "s3" {
    bucket         = "radar-tf-state-prod"
    key            = "prod/terraform.tfstate"
    region         = "sa-east-1"
    encrypt        = true
    dynamodb_table = "radar-tf-lock"
  }
}
