# Staging Environment Configuration for Fusion Bitcoin Bridge
# This file contains variable values specific to staging environment

# Environment Configuration
environment = "staging"
aws_region = "us-west-2"
availability_zone_count = 2

# Network Configuration
vpc_cidr = "10.1.0.0/16"

# Domain and Certificate Configuration
domain_name = "staging.fusion-bitcoin.1inch.io"
certificate_arn = "arn:aws:acm:us-west-2:123456789012:certificate/staging-cert-id"

# Storage Configuration
s3_versioning_enabled = true
s3_lifecycle_enabled = true

# CloudFront Configuration
cloudfront_enabled = true
cloudfront_price_class = "PriceClass_100"

# Monitoring Configuration
enable_enhanced_monitoring = true
monitoring_interval = 60

# Security Configuration
enable_encryption = true
enable_deletion_protection = false
enable_waf = true
enable_shield = false
enable_guardduty = true
enable_config = true

# Auto Scaling Configuration
enable_auto_scaling = true
enable_spot_instances = true

# Cost Optimization
backup_retention_days = 7

# Additional Tags for Staging Environment
additional_tags = {
  CostCenter = "development"
  Owner = "devops-team"
  Purpose = "staging-environment"
  Backup = "enabled"
}

# Resource Naming
resource_prefix = "fusion-bitcoin"
resource_suffix = "staging"