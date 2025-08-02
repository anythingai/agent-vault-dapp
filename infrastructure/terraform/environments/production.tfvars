# Production Environment Configuration for Fusion Bitcoin Bridge
# This file contains variable values specific to production environment

# Environment Configuration
environment = "production"
aws_region = "us-west-2"
availability_zone_count = 3

# Network Configuration
vpc_cidr = "10.2.0.0/16"
production_cidr_blocks = [
  "10.0.0.0/8",     # Internal VPC traffic
  "172.16.0.0/12",  # Private networks
  "192.168.0.0/16"  # Private networks
]

# Domain and Certificate Configuration
domain_name = "fusion-bitcoin.1inch.io"
certificate_arn = "arn:aws:acm:us-west-2:123456789012:certificate/production-cert-id"

# Storage Configuration
s3_versioning_enabled = true
s3_lifecycle_enabled = true

# CloudFront Configuration
cloudfront_enabled = true
cloudfront_price_class = "PriceClass_All"

# Monitoring Configuration
enable_enhanced_monitoring = true
monitoring_interval = 60

# Security Configuration
enable_encryption = true
enable_deletion_protection = true
enable_waf = true
enable_shield = true
enable_guardduty = true
enable_config = true

# Auto Scaling Configuration
enable_auto_scaling = true
enable_spot_instances = false  # Use on-demand for production stability

# Cost Optimization
backup_retention_days = 30

# Additional Tags for Production Environment
additional_tags = {
  CostCenter = "production"
  Owner = "platform-team"
  Purpose = "production-workload"
  Backup = "enabled"
  Compliance = "required"
  CriticalityLevel = "high"
}

# Resource Naming
resource_prefix = "fusion-bitcoin"
resource_suffix = "prod"