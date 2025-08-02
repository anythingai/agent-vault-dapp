# Outputs for Fusion Bitcoin Bridge Infrastructure
# Provides important resource information for other systems and debugging

# Network Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "vpc_cidr_block" {
  description = "CIDR block of the VPC"
  value       = module.vpc.vpc_cidr_block
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

output "nat_gateway_ids" {
  description = "IDs of the NAT Gateways"
  value       = module.vpc.natgw_ids
}

# EKS Outputs
output "eks_cluster_endpoint" {
  description = "Endpoint for EKS control plane"
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_name" {
  description = "Kubernetes Cluster Name"
  value       = module.eks.cluster_name
}

output "eks_cluster_version" {
  description = "The Kubernetes version for the EKS cluster"
  value       = module.eks.cluster_version
}

output "eks_cluster_security_group_id" {
  description = "Security group ID attached to the EKS cluster"
  value       = module.eks.cluster_security_group_id
}

output "eks_node_groups" {
  description = "EKS node groups"
  value       = module.eks.eks_managed_node_groups
}

output "eks_oidc_provider_arn" {
  description = "The ARN of the OIDC Provider for EKS"
  value       = module.eks.oidc_provider_arn
}

output "eks_cluster_arn" {
  description = "The Amazon Resource Name (ARN) of the cluster"
  value       = module.eks.cluster_arn
}

# Database Outputs
output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = module.rds.db_instance_endpoint
  sensitive   = true
}

output "rds_port" {
  description = "RDS instance port"
  value       = module.rds.db_instance_port
}

output "rds_instance_id" {
  description = "RDS instance ID"
  value       = module.rds.db_instance_identifier
}

output "rds_instance_arn" {
  description = "RDS instance ARN"
  value       = module.rds.db_instance_arn
}

output "database_name" {
  description = "Name of the database"
  value       = module.rds.db_instance_name
}

# Redis Outputs
output "redis_endpoint" {
  description = "Redis cluster endpoint"
  value       = module.elasticache.primary_endpoint_address
  sensitive   = true
}

output "redis_port" {
  description = "Redis cluster port"
  value       = local.redis_config.port
}

output "redis_cluster_id" {
  description = "Redis cluster ID"
  value       = module.elasticache.cluster_id
}

output "redis_auth_token_required" {
  description = "Whether Redis requires authentication"
  value       = local.redis_config.transit_encryption_enabled
}

# S3 Outputs
output "s3_bucket_names" {
  description = "Names of S3 buckets"
  value = {
    artifacts = module.s3_artifacts.s3_bucket_id
    backups   = module.s3_backups.s3_bucket_id
    logs      = module.s3_logs.s3_bucket_id
    frontend  = module.s3_frontend.s3_bucket_id
  }
}

output "s3_bucket_arns" {
  description = "ARNs of S3 buckets"
  value = {
    artifacts = module.s3_artifacts.s3_bucket_arn
    backups   = module.s3_backups.s3_bucket_arn
    logs      = module.s3_logs.s3_bucket_arn
    frontend  = module.s3_frontend.s3_bucket_arn
  }
}

# CloudFront Outputs
output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = var.cloudfront_enabled ? module.cloudfront[0].cloudfront_distribution_id : null
}

output "cloudfront_distribution_domain" {
  description = "CloudFront distribution domain name"
  value       = var.cloudfront_enabled ? module.cloudfront[0].cloudfront_distribution_domain_name : null
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN"
  value       = var.cloudfront_enabled ? module.cloudfront[0].cloudfront_distribution_arn : null
}

# Load Balancer Outputs
output "load_balancer_dns" {
  description = "Load balancer DNS name"
  value       = module.alb.lb_dns_name
}

output "load_balancer_arn" {
  description = "Load balancer ARN"
  value       = module.alb.lb_arn
}

output "load_balancer_zone_id" {
  description = "Load balancer zone ID"
  value       = module.alb.lb_zone_id
}

output "target_group_arns" {
  description = "ARNs of the target groups"
  value       = module.alb.target_group_arns
}

# Security Outputs
output "security_groups" {
  description = "Security group IDs"
  value = {
    alb          = aws_security_group.alb.id
    eks_cluster  = aws_security_group.eks_cluster.id
    eks_nodes    = aws_security_group.eks_nodes.id
    rds          = aws_security_group.rds.id
    redis        = aws_security_group.redis.id
    monitoring   = aws_security_group.monitoring.id
  }
}

output "kms_key_arns" {
  description = "KMS key ARNs"
  value = {
    eks        = aws_kms_key.eks.arn
    rds        = aws_kms_key.rds.arn
    redis      = aws_kms_key.redis.arn
    s3         = aws_kms_key.s3.arn
    cloudwatch = aws_kms_key.cloudwatch.arn
  }
}

# WAF Outputs
output "waf_web_acl_arn" {
  description = "WAF Web ACL ARN"
  value       = var.enable_waf && var.environment != "local" ? aws_wafv2_web_acl.main[0].arn : null
}

output "waf_web_acl_id" {
  description = "WAF Web ACL ID"
  value       = var.enable_waf && var.environment != "local" ? aws_wafv2_web_acl.main[0].id : null
}

# IAM Outputs
output "iam_roles" {
  description = "IAM role ARNs"
  value = {
    aws_load_balancer_controller = aws_iam_role.aws_load_balancer_controller.arn
    external_dns = var.certificate_arn != "" ? aws_iam_role.external_dns[0].arn : null
    vpc_cni      = aws_iam_role.vpc_cni_role.arn
    ebs_csi      = aws_iam_role.ebs_csi_role.arn
  }
}

# Secrets Manager Outputs
output "secrets_manager_arns" {
  description = "Secrets Manager secret ARNs"
  value = {
    db_credentials          = aws_secretsmanager_secret.db_credentials.arn
    redis_credentials       = aws_secretsmanager_secret.redis_credentials.arn
    application_secrets     = aws_secretsmanager_secret.application_secrets.arn
  }
}

# Route53 Outputs
output "route53_records" {
  description = "Route53 record names"
  value = var.certificate_arn != "" && var.domain_name != "" ? {
    main = aws_route53_record.main[0].fqdn
    www  = aws_route53_record.www[0].fqdn
  } : {}
}

# Monitoring Outputs
output "cloudwatch_log_groups" {
  description = "CloudWatch log group names"
  value = {
    application = { for k, v in aws_cloudwatch_log_group.application : k => v.name }
    infrastructure = { for k, v in aws_cloudwatch_log_group.infrastructure : k => v.name }
  }
}

output "cloudwatch_dashboard_url" {
  description = "CloudWatch dashboard URL"
  value       = "https://${data.aws_region.current.name}.console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.name}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}

# Configuration for kubectl
output "kubectl_config" {
  description = "kubectl configuration command"
  value       = "aws eks update-kubeconfig --region ${data.aws_region.current.name} --name ${module.eks.cluster_name}"
}

# Environment Information
output "environment_info" {
  description = "Environment information"
  value = {
    environment = var.environment
    region      = data.aws_region.current.name
    account_id  = data.aws_caller_identity.current.account_id
    name_prefix = local.name_prefix
  }
}

# Cost Estimation Tags
output "cost_allocation_tags" {
  description = "Tags for cost allocation"
  value = {
    Project     = "fusion-bitcoin-bridge"
    Environment = var.environment
    ManagedBy   = "terraform"
    Owner       = "1inch-devops"
  }
}

# Health Check URLs
output "health_check_urls" {
  description = "Health check URLs for services"
  value = var.certificate_arn != "" && var.domain_name != "" ? {
    frontend = "https://${var.domain_name}/health"
    api      = "https://api.${var.domain_name}/health"
  } : {
    frontend = "http://${module.alb.lb_dns_name}/health"
    api      = "http://${module.alb.lb_dns_name}/api/health"
  }
}

# Backup Information
output "backup_configuration" {
  description = "Backup configuration details"
  value = {
    rds_backup_retention_period = local.db_config.backup_retention_period
    rds_backup_window          = local.db_config.backup_window
    redis_snapshot_retention   = var.environment == "production" ? 7 : 1
    s3_lifecycle_enabled       = var.s3_lifecycle_enabled
  }
}

# Network Configuration Summary
output "network_summary" {
  description = "Network configuration summary"
  value = {
    vpc_cidr                = local.vpc_cidr
    availability_zones     = local.azs
    nat_gateways_count     = var.environment == "local" ? 1 : (var.environment == "production" ? length(local.azs) : 1)
    multi_az_deployment    = var.environment == "production"
  }
}