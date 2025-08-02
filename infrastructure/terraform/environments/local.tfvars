# Local Environment Configuration for Fusion Bitcoin Bridge
# This file contains variable values specific to local development environment

# Environment Configuration
environment = "local"
aws_region = "us-west-2"
availability_zone_count = 2

# Network Configuration
vpc_cidr = "10.0.0.0/16"

# Domain and Certificate Configuration
domain_name = "localhost"
certificate_arn = ""

# Database Configuration (overrides)
database_config = {
  local = {
    instance_class    = "db.t3.micro"
    allocated_storage = 20
    max_allocated_storage = 50
    multi_az         = false
    backup_retention_period = 1
    backup_window    = "03:00-04:00"
    maintenance_window = "Sun:04:00-Sun:05:00"
    deletion_protection = false
    skip_final_snapshot = true
  }
  staging = {
    instance_class    = "db.t3.small"
    allocated_storage = 50
    max_allocated_storage = 200
    multi_az         = false
    backup_retention_period = 7
    backup_window    = "03:00-04:00"
    maintenance_window = "Sun:04:00-Sun:05:00"
    deletion_protection = false
    skip_final_snapshot = true
  }
  production = {
    instance_class    = "db.r5.large"
    allocated_storage = 100
    max_allocated_storage = 1000
    multi_az         = true
    backup_retention_period = 30
    backup_window    = "03:00-04:00"
    maintenance_window = "Sun:04:00-Sun:05:00"
    deletion_protection = true
    skip_final_snapshot = false
  }
}

# Redis Configuration (overrides)
redis_config = {
  local = {
    node_type    = "cache.t3.micro"
    num_cache_nodes = 1
    parameter_group_name = "default.redis7.x"
    port         = 6379
    at_rest_encryption_enabled = false
    transit_encryption_enabled = false
  }
  staging = {
    node_type    = "cache.t3.small"
    num_cache_nodes = 1
    parameter_group_name = "default.redis7.x"
    port         = 6379
    at_rest_encryption_enabled = true
    transit_encryption_enabled = true
  }
  production = {
    node_type    = "cache.r5.large"
    num_cache_nodes = 2
    parameter_group_name = "default.redis7.x"
    port         = 6379
    at_rest_encryption_enabled = true
    transit_encryption_enabled = true
  }
}

# EKS Configuration (overrides)
eks_config = {
  local = {
    cluster_version = "1.28"
    node_groups = {
      main = {
        instance_types = ["t3.medium"]
        min_size      = 1
        max_size      = 2
        desired_size  = 1
        capacity_type = "ON_DEMAND"
        disk_size     = 50
      }
    }
  }
  staging = {
    cluster_version = "1.28"
    node_groups = {
      main = {
        instance_types = ["t3.large"]
        min_size      = 2
        max_size      = 5
        desired_size  = 3
        capacity_type = "ON_DEMAND"
        disk_size     = 100
      }
    }
  }
  production = {
    cluster_version = "1.28"
    node_groups = {
      main = {
        instance_types = ["c5.xlarge"]
        min_size      = 3
        max_size      = 10
        desired_size  = 5
        capacity_type = "ON_DEMAND"
        disk_size     = 100
      }
    }
  }
}

# Storage Configuration
s3_versioning_enabled = false
s3_lifecycle_enabled = false

# CloudFront Configuration
cloudfront_enabled = false
cloudfront_price_class = "PriceClass_100"

# Monitoring Configuration
enable_enhanced_monitoring = false
monitoring_interval = 0

# Security Configuration
enable_encryption = false
enable_deletion_protection = false
enable_waf = false
enable_shield = false
enable_guardduty = false
enable_config = false

# Auto Scaling Configuration
enable_auto_scaling = false
enable_spot_instances = false

# Cost Optimization
backup_retention_days = 1

# Additional Tags for Local Environment
additional_tags = {
  CostCenter = "development"
  Owner = "developer"
  Purpose = "local-testing"
  DeleteAfter = "7days"
}

# Resource Naming
resource_prefix = "fusion-bitcoin"
resource_suffix = "local"