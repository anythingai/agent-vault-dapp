# Terraform configuration for 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin
# Main infrastructure provisioning for AWS cloud resources

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.4"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    # This will be configured per environment
    # bucket = "fusion-bitcoin-terraform-state-${var.environment}"
    # key    = "infrastructure/terraform.tfstate"
    # region = var.aws_region
    # encrypt = true
    # dynamodb_table = "fusion-bitcoin-terraform-locks-${var.environment}"
  }
}

# Configure AWS Provider
provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "fusion-bitcoin-bridge"
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = "1inch-devops"
      CreatedDate = formatdate("YYYY-MM-DD", timestamp())
    }
  }
}

# Data sources
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# Local values
locals {
  # Common naming convention
  name_prefix = "fusion-bitcoin-${var.environment}"
  
  # Network configuration
  vpc_cidr = var.vpc_cidr
  azs      = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)
  
  # Subnet calculations
  private_subnets = [for i in range(var.availability_zone_count) : cidrsubnet(local.vpc_cidr, 4, i)]
  public_subnets  = [for i in range(var.availability_zone_count) : cidrsubnet(local.vpc_cidr, 4, i + var.availability_zone_count)]
  database_subnets = [for i in range(var.availability_zone_count) : cidrsubnet(local.vpc_cidr, 4, i + 2 * var.availability_zone_count)]
  
  # Common tags
  common_tags = {
    Project     = "fusion-bitcoin-bridge"
    Environment = var.environment
    ManagedBy   = "terraform"
    Owner       = "1inch-devops"
  }
  
  # Security group rules
  allowed_cidr_blocks = var.environment == "production" ? var.production_cidr_blocks : ["0.0.0.0/0"]
  
  # Database configuration
  db_config = var.database_config[var.environment]
  redis_config = var.redis_config[var.environment]
  
  # EKS configuration
  eks_config = var.eks_config[var.environment]
}

# Random password for database
resource "random_password" "db_password" {
  length  = 16
  special = true
}

# Random password for Redis
resource "random_password" "redis_password" {
  length = 32
  special = false
}

# Output important values
output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = module.vpc.private_subnets
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = module.vpc.public_subnets
}

output "database_subnet_ids" {
  description = "IDs of the database subnets"
  value       = module.vpc.database_subnets
}

output "eks_cluster_endpoint" {
  description = "Endpoint for EKS control plane"
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_name" {
  description = "Kubernetes Cluster Name"
  value       = module.eks.cluster_name
}

output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = module.rds.db_instance_endpoint
  sensitive   = true
}

output "elasticache_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = module.elasticache.primary_endpoint_address
  sensitive   = true
}

output "s3_bucket_names" {
  description = "Names of S3 buckets"
  value = {
    artifacts = module.s3_artifacts.s3_bucket_id
    backups   = module.s3_backups.s3_bucket_id
    logs      = module.s3_logs.s3_bucket_id
  }
}

output "cloudfront_distribution_domain" {
  description = "CloudFront distribution domain name"
  value       = module.cloudfront.cloudfront_distribution_domain_name
}

output "load_balancer_dns" {
  description = "Load balancer DNS name"
  value       = module.alb.lb_dns_name
}