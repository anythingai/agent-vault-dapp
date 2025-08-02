# S3 Buckets and CloudFront Configuration for Fusion Bitcoin Bridge
# Creates S3 buckets for artifacts, backups, logs, and static content with CloudFront distribution

# KMS Key for S3 encryption
resource "aws_kms_key" "s3" {
  description             = "S3 encryption key for ${local.name_prefix}"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow CloudFront Service Principal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = "*"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-s3-key"
    Type = "KMSKey"
  })
}

resource "aws_kms_alias" "s3" {
  name          = "alias/${local.name_prefix}-s3"
  target_key_id = aws_kms_key.s3.key_id
}

# S3 Bucket for Application Artifacts (Docker images, builds, etc.)
module "s3_artifacts" {
  source = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 3.0"

  bucket = "${local.name_prefix}-artifacts-${random_id.bucket_suffix.hex}"
  
  # Block all public access
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

  # Versioning
  versioning = {
    enabled = var.s3_versioning_enabled
  }

  # Server-side encryption
  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        kms_master_key_id = aws_kms_key.s3.arn
        sse_algorithm     = "aws:kms"
      }
      bucket_key_enabled = true
    }
  }

  # Lifecycle configuration
  lifecycle_configuration = var.s3_lifecycle_enabled ? {
    rule = [
      {
        id     = "artifacts_lifecycle"
        status = "Enabled"
        
        transition = [
          {
            days          = 30
            storage_class = "STANDARD_IA"
          },
          {
            days          = 90
            storage_class = "GLACIER"
          },
          {
            days          = 365
            storage_class = "DEEP_ARCHIVE"
          }
        ]

        noncurrent_version_expiration = {
          days = 90
        }

        abort_incomplete_multipart_upload_days = 7
      }
    ]
  } : {}

  # Logging
  logging = {
    target_bucket = module.s3_logs.s3_bucket_id
    target_prefix = "artifacts-access-logs/"
  }

  # Notification configuration
  notification_configuration = var.environment == "production" ? {
    topic = [
      {
        topic_arn     = aws_sns_topic.s3_notifications[0].arn
        events        = ["s3:ObjectCreated:*"]
        filter_prefix = "builds/"
        filter_suffix = ".tar.gz"
      }
    ]
  } : {}

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-artifacts"
    Type = "S3Bucket"
    Purpose = "Artifacts"
  })

  depends_on = [module.s3_logs]
}

# S3 Bucket for Backups
module "s3_backups" {
  source = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 3.0"

  bucket = "${local.name_prefix}-backups-${random_id.bucket_suffix.hex}"
  
  # Block all public access
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

  # Versioning
  versioning = {
    enabled = true
  }

  # Server-side encryption
  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        kms_master_key_id = aws_kms_key.s3.arn
        sse_algorithm     = "aws:kms"
      }
      bucket_key_enabled = true
    }
  }

  # MFA Delete (production only)
  mfa_delete = var.environment == "production"

  # Lifecycle configuration for backups
  lifecycle_configuration = {
    rule = [
      {
        id     = "backup_lifecycle"
        status = "Enabled"
        
        transition = [
          {
            days          = 7
            storage_class = "STANDARD_IA"
          },
          {
            days          = 30
            storage_class = "GLACIER"
          },
          {
            days          = 90
            storage_class = "DEEP_ARCHIVE"
          }
        ]

        expiration = {
          days = var.environment == "production" ? 2555 : 365  # 7 years for production, 1 year for others
        }

        noncurrent_version_expiration = {
          days = 30
        }

        abort_incomplete_multipart_upload_days = 1
      }
    ]
  }

  # Cross-region replication (production only)
  replication_configuration = var.environment == "production" ? {
    role = aws_iam_role.s3_replication[0].arn
    
    rules = [
      {
        id       = "backup_replication"
        status   = "Enabled"
        priority = 1

        destination = {
          bucket             = "arn:aws:s3:::${local.name_prefix}-backups-replica-${random_id.bucket_suffix.hex}"
          storage_class      = "STANDARD_IA"
          replica_kms_key_id = aws_kms_key.s3.arn
        }

        source_selection_criteria = {
          sse_kms_encrypted_objects = {
            enabled = true
          }
        }
      }
    ]
  } : {}

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-backups"
    Type = "S3Bucket"
    Purpose = "Backups"
  })
}

# S3 Bucket for Access Logs
module "s3_logs" {
  source = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 3.0"

  bucket = "${local.name_prefix}-logs-${random_id.bucket_suffix.hex}"
  
  # Block all public access
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

  # Server-side encryption
  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        kms_master_key_id = aws_kms_key.s3.arn
        sse_algorithm     = "aws:kms"
      }
      bucket_key_enabled = true
    }
  }

  # Lifecycle configuration for logs
  lifecycle_configuration = {
    rule = [
      {
        id     = "logs_lifecycle"
        status = "Enabled"
        
        transition = [
          {
            days          = 30
            storage_class = "STANDARD_IA"
          },
          {
            days          = 90
            storage_class = "GLACIER"
          }
        ]

        expiration = {
          days = 90
        }

        abort_incomplete_multipart_upload_days = 1
      }
    ]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-logs"
    Type = "S3Bucket"
    Purpose = "AccessLogs"
  })
}

# S3 Bucket for Static Frontend Content
module "s3_frontend" {
  source = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 3.0"

  bucket = "${local.name_prefix}-frontend-${random_id.bucket_suffix.hex}"
  
  # Block public access (CloudFront will handle public access)
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

  # Versioning
  versioning = {
    enabled = var.s3_versioning_enabled
  }

  # Server-side encryption
  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        kms_master_key_id = aws_kms_key.s3.arn
        sse_algorithm     = "aws:kms"
      }
      bucket_key_enabled = true
    }
  }

  # Website configuration
  website = {
    index_document = "index.html"
    error_document = "error.html"
  }

  # CORS configuration
  cors_rule = [
    {
      allowed_headers = ["*"]
      allowed_methods = ["GET", "HEAD"]
      allowed_origins = var.environment == "production" ? ["https://${var.domain_name}"] : ["*"]
      expose_headers  = ["ETag"]
      max_age_seconds = 3000
    }
  ]

  # Lifecycle configuration
  lifecycle_configuration = var.s3_lifecycle_enabled ? {
    rule = [
      {
        id     = "frontend_lifecycle"
        status = "Enabled"
        
        noncurrent_version_expiration = {
          days = 30
        }

        abort_incomplete_multipart_upload_days = 7
      }
    ]
  } : {}

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-frontend"
    Type = "S3Bucket"
    Purpose = "StaticWebsite"
  })
}

# Random ID for unique bucket naming
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# CloudFront Origin Access Control
resource "aws_cloudfront_origin_access_control" "main" {
  count = var.cloudfront_enabled ? 1 : 0
  
  name                              = "${local.name_prefix}-oac"
  description                       = "OAC for ${local.name_prefix} frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Distribution
module "cloudfront" {
  source = "terraform-aws-modules/cloudfront/aws"
  version = "~> 3.0"

  count = var.cloudfront_enabled ? 1 : 0

  comment         = "CloudFront distribution for ${local.name_prefix}"
  enabled         = true
  is_ipv6_enabled = true
  price_class     = var.cloudfront_price_class
  retain_on_delete = false
  wait_for_deployment = false

  # Aliases (domain names)
  aliases = var.certificate_arn != "" ? [var.domain_name, "www.${var.domain_name}"] : []

  # Default root object
  default_root_object = "index.html"

  # Origin configuration
  origin = {
    s3_frontend = {
      domain_name = module.s3_frontend.s3_bucket_bucket_regional_domain_name
      origin_id   = "S3-${module.s3_frontend.s3_bucket_id}"
      
      origin_access_control_id = aws_cloudfront_origin_access_control.main[0].id
    }
  }

  # Default cache behavior
  default_cache_behavior = {
    target_origin_id       = "S3-${module.s3_frontend.s3_bucket_id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    query_string           = false

    # TTL settings
    min_ttl     = 0
    default_ttl = 86400   # 1 day
    max_ttl     = 31536000 # 1 year

    # Forward headers
    headers = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]

    # Cookie forwarding
    cookies_forward = "none"

    # Response headers policy
    response_headers_policy_id = aws_cloudfront_response_headers_policy.main[0].id
  }

  # Additional cache behaviors
  ordered_cache_behavior = [
    {
      path_pattern           = "/api/*"
      target_origin_id       = "ALB-${local.name_prefix}"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      min_ttl     = 0
      default_ttl = 0
      max_ttl     = 0

      headers = ["*"]
      query_string = true
      cookies_forward = "all"
    },
    {
      path_pattern           = "/assets/*"
      target_origin_id       = "S3-${module.s3_frontend.s3_bucket_id}"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      min_ttl     = 86400     # 1 day
      default_ttl = 31536000  # 1 year
      max_ttl     = 31536000  # 1 year

      headers = []
      query_string = false
      cookies_forward = "none"
    }
  ]

  # Custom error responses
  custom_error_response = [
    {
      error_code            = 403
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    },
    {
      error_code            = 404
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
  ]

  # Viewer certificate
  viewer_certificate = var.certificate_arn != "" ? {
    acm_certificate_arn            = var.certificate_arn
    ssl_support_method             = "sni-only"
    minimum_protocol_version       = "TLSv1.2_2021"
    cloudfront_default_certificate = false
  } : {
    cloudfront_default_certificate = true
  }

  # Geographic restrictions
  geo_restriction = var.environment == "production" ? {
    restriction_type = "none"  # Change to "whitelist" or "blacklist" if needed
    locations        = []
  } : {
    restriction_type = "none"
    locations        = []
  }

  # Web ACL
  web_acl_id = var.enable_waf && var.environment != "local" ? aws_wafv2_web_acl.main[0].arn : null

  # Logging
  logging_config = var.environment != "local" ? {
    bucket          = module.s3_logs.s3_bucket_bucket_domain_name
    prefix          = "cloudfront-access-logs/"
    include_cookies = false
  } : {}

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cloudfront"
    Type = "CloudFrontDistribution"
  })

  depends_on = [module.s3_frontend, module.s3_logs]
}

# CloudFront Response Headers Policy
resource "aws_cloudfront_response_headers_policy" "main" {
  count = var.cloudfront_enabled ? 1 : 0
  
  name    = "${local.name_prefix}-security-headers"
  comment = "Security headers policy for ${local.name_prefix}"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = false
    }
    
    content_type_options {
      override = false
    }
    
    frame_options {
      frame_option = "SAMEORIGIN"
      override     = false
    }
    
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = false
    }
  }

  cors_config {
    access_control_allow_credentials = false
    
    access_control_allow_headers {
      items = ["*"]
    }
    
    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS", "POST", "PUT"]
    }
    
    access_control_allow_origins {
      items = var.environment == "production" ? ["https://${var.domain_name}"] : ["*"]
    }
    
    origin_override = false
  }

  custom_headers_config {
    items {
      header   = "X-API-Version"
      value    = "1.0"
      override = false
    }
    
    items {
      header   = "X-Environment"
      value    = var.environment
      override = false
    }
  }
}

# S3 Bucket Policy for CloudFront OAC
resource "aws_s3_bucket_policy" "frontend_oac" {
  count = var.cloudfront_enabled ? 1 : 0
  
  bucket = module.s3_frontend.s3_bucket_id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipal"
        Effect    = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${module.s3_frontend.s3_bucket_arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = module.cloudfront[0].cloudfront_distribution_arn
          }
        }
      }
    ]
  })

  depends_on = [module.cloudfront]
}

# SNS Topic for S3 Notifications (production only)
resource "aws_sns_topic" "s3_notifications" {
  count = var.environment == "production" ? 1 : 0
  
  name = "${local.name_prefix}-s3-notifications"
  kms_master_key_id = aws_kms_key.s3.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-s3-notifications"
    Type = "SNSTopic"
  })
}

# IAM Role for S3 Cross-Region Replication (production only)
resource "aws_iam_role" "s3_replication" {
  count = var.environment == "production" ? 1 : 0
  
  name = "${local.name_prefix}-s3-replication-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
      }
    ]
  })

  inline_policy {
    name = "S3ReplicationPolicy"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect = "Allow"
          Action = [
            "s3:GetObjectVersionForReplication",
            "s3:GetObjectVersionAcl"
          ]
          Resource = "${module.s3_backups.s3_bucket_arn}/*"
        },
        {
          Effect = "Allow"
          Action = [
            "s3:ListBucket"
          ]
          Resource = module.s3_backups.s3_bucket_arn
        },
        {
          Effect = "Allow"
          Action = [
            "s3:ReplicateObject",
            "s3:ReplicateDelete"
          ]
          Resource = "arn:aws:s3:::${local.name_prefix}-backups-replica-${random_id.bucket_suffix.hex}/*"
        },
        {
          Effect = "Allow"
          Action = [
            "kms:Decrypt",
            "kms:DescribeKey",
            "kms:GenerateDataKey"
          ]
          Resource = aws_kms_key.s3.arn
        }
      ]
    })
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-s3-replication-role"
    Type = "IAMRole"
  })
}