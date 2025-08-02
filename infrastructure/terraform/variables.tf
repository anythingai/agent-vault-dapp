# Terraform variables for 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin
# Infrastructure provisioning variables

# Environment Configuration
variable "environment" {
  description = "Environment name (local, staging, production)"
  type        = string
  default     = "staging"
  
  validation {
    condition     = contains(["local", "staging", "production"], var.environment)
    error_message = "Environment must be one of: local, staging, production."
  }
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-west-2"
}

variable "availability_zone_count" {
  description = "Number of availability zones to use"
  type        = number
  default     = 3
  
  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 6
    error_message = "Availability zone count must be between 2 and 6."
  }
}

# Network Configuration
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "production_cidr_blocks" {
  description = "Allowed CIDR blocks for production environment"
  type        = list(string)
  default = [
    "10.0.0.0/8",     # Internal VPC traffic
    "172.16.0.0/12",  # Private networks
    "192.168.0.0/16"  # Private networks
  ]
}

# Database Configuration
variable "database_config" {
  description = "Database configuration per environment"
  type = map(object({
    instance_class    = string
    allocated_storage = number
    max_allocated_storage = number
    multi_az         = bool
    backup_retention_period = number
    backup_window    = string
    maintenance_window = string
    deletion_protection = bool
    skip_final_snapshot = bool
  }))
  
  default = {
    local = {
      instance_class    = "db.t3.micro"
      allocated_storage = 20
      max_allocated_storage = 100
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
}

# Redis Configuration
variable "redis_config" {
  description = "Redis configuration per environment"
  type = map(object({
    node_type    = string
    num_cache_nodes = number
    parameter_group_name = string
    port         = number
    at_rest_encryption_enabled = bool
    transit_encryption_enabled = bool
  }))
  
  default = {
    local = {
      node_type    = "cache.t3.micro"
      num_cache_nodes = 1
      parameter_group_name = "default.redis7"
      port         = 6379
      at_rest_encryption_enabled = false
      transit_encryption_enabled = false
    }
    staging = {
      node_type    = "cache.t3.small"
      num_cache_nodes = 1
      parameter_group_name = "default.redis7"
      port         = 6379
      at_rest_encryption_enabled = true
      transit_encryption_enabled = true
    }
    production = {
      node_type    = "cache.r5.large"
      num_cache_nodes = 2
      parameter_group_name = "default.redis7"
      port         = 6379
      at_rest_encryption_enabled = true
      transit_encryption_enabled = true
    }
  }
}

# EKS Configuration
variable "eks_config" {
  description = "EKS configuration per environment"
  type = map(object({
    cluster_version = string
    node_groups = map(object({
      instance_types = list(string)
      min_size      = number
      max_size      = number
      desired_size  = number
      capacity_type = string
      disk_size     = number
    }))
  }))
  
  default = {
    local = {
      cluster_version = "1.28"
      node_groups = {
        main = {
          instance_types = ["t3.medium"]
          min_size      = 1
          max_size      = 3
          desired_size  = 2
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
        spot = {
          instance_types = ["t3.large", "t3.xlarge", "c5.large"]
          min_size      = 0
          max_size      = 10
          desired_size  = 2
          capacity_type = "SPOT"
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
        compute = {
          instance_types = ["c5.2xlarge"]
          min_size      = 2
          max_size      = 20
          desired_size  = 5
          capacity_type = "ON_DEMAND"
          disk_size     = 200
        }
        spot = {
          instance_types = ["c5.large", "c5.xlarge", "m5.large", "m5.xlarge"]
          min_size      = 0
          max_size      = 20
          desired_size  = 5
          capacity_type = "SPOT"
          disk_size     = 100
        }
      }
    }
  }
}

# S3 Configuration
variable "s3_versioning_enabled" {
  description = "Enable S3 versioning"
  type        = bool
  default     = true
}

variable "s3_lifecycle_enabled" {
  description = "Enable S3 lifecycle management"
  type        = bool
  default     = true
}

# CloudFront Configuration
variable "cloudfront_enabled" {
  description = "Enable CloudFront distribution"
  type        = bool
  default     = true
}

variable "cloudfront_price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"
  
  validation {
    condition = contains([
      "PriceClass_All",
      "PriceClass_200", 
      "PriceClass_100"
    ], var.cloudfront_price_class)
    error_message = "CloudFront price class must be one of: PriceClass_All, PriceClass_200, PriceClass_100."
  }
}

# Monitoring Configuration
variable "enable_enhanced_monitoring" {
  description = "Enable enhanced monitoring for RDS and other services"
  type        = bool
  default     = true
}

variable "monitoring_interval" {
  description = "Monitoring interval in seconds"
  type        = number
  default     = 60
  
  validation {
    condition     = contains([0, 1, 5, 10, 15, 30, 60], var.monitoring_interval)
    error_message = "Monitoring interval must be one of: 0, 1, 5, 10, 15, 30, 60."
  }
}

# Security Configuration
variable "enable_encryption" {
  description = "Enable encryption for supported resources"
  type        = bool
  default     = true
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection for critical resources"
  type        = bool
  default     = true
}

# Backup Configuration
variable "backup_retention_days" {
  description = "Number of days to retain backups"
  type        = number
  default     = 30
  
  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "Backup retention days must be between 1 and 35."
  }
}

# Auto Scaling Configuration
variable "enable_auto_scaling" {
  description = "Enable auto scaling for EKS nodes"
  type        = bool
  default     = true
}

# Cost Optimization
variable "enable_spot_instances" {
  description = "Enable spot instances for cost optimization"
  type        = bool
  default     = false
}

# Domain Configuration
variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "fusion-bitcoin.example.com"
}

variable "certificate_arn" {
  description = "ARN of the SSL certificate for the domain"
  type        = string
  default     = ""
}

# Feature Flags
variable "enable_waf" {
  description = "Enable AWS WAF for web application firewall"
  type        = bool
  default     = true
}

variable "enable_shield" {
  description = "Enable AWS Shield for DDoS protection"
  type        = bool
  default     = false
}

variable "enable_guardduty" {
  description = "Enable AWS GuardDuty for threat detection"
  type        = bool
  default     = true
}

variable "enable_config" {
  description = "Enable AWS Config for compliance monitoring"
  type        = bool
  default     = true
}

# Tagging
variable "additional_tags" {
  description = "Additional tags to apply to resources"
  type        = map(string)
  default     = {}
}

# Resource Naming
variable "resource_prefix" {
  description = "Prefix for resource naming"
  type        = string
  default     = "fusion-bitcoin"
}

variable "resource_suffix" {
  description = "Suffix for resource naming"
  type        = string
  default     = ""
}