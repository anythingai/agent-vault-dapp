# RDS PostgreSQL Database Configuration for Fusion Bitcoin Bridge
# Creates RDS instance, subnet group, parameter group, and related resources

# KMS Key for RDS encryption
resource "aws_kms_key" "rds" {
  description             = "RDS encryption key for ${local.name_prefix}"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-rds-key"
    Type = "KMSKey"
  })
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${local.name_prefix}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

# RDS Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = module.vpc.database_subnets

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-subnet-group"
    Type = "DBSubnetGroup"
  })
}

# RDS Parameter Group
resource "aws_db_parameter_group" "main" {
  family = "postgres15"
  name   = "${local.name_prefix}-db-params"

  # Performance optimizations
  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  parameter {
    name  = "log_statement"
    value = "all"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"  # Log queries taking longer than 1 second
  }

  parameter {
    name  = "log_checkpoints"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  # Connection settings
  parameter {
    name  = "max_connections"
    value = var.environment == "production" ? "200" : "100"
  }

  # Memory settings
  parameter {
    name  = "shared_buffers"
    value = var.environment == "production" ? "{DBInstanceClassMemory/4}" : "{DBInstanceClassMemory/8}"
  }

  parameter {
    name  = "effective_cache_size"
    value = var.environment == "production" ? "{DBInstanceClassMemory*3/4}" : "{DBInstanceClassMemory/2}"
  }

  # Checkpoint settings
  parameter {
    name  = "checkpoint_completion_target"
    value = "0.9"
  }

  parameter {
    name  = "wal_buffers"
    value = "16MB"
  }

  # Query planner settings
  parameter {
    name  = "random_page_cost"
    value = "1.1"  # SSD optimization
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-params"
    Type = "DBParameterGroup"
  })
}

# RDS Option Group
resource "aws_db_option_group" "main" {
  name                     = "${local.name_prefix}-db-options"
  option_group_description = "Option group for ${local.name_prefix}"
  engine_name              = "postgres"
  major_engine_version     = "15"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-options"
    Type = "DBOptionGroup"
  })
}

# RDS Instance
module "rds" {
  source = "terraform-aws-modules/rds/aws"
  version = "~> 6.0"

  identifier = "${local.name_prefix}-db"

  # Engine
  engine               = "postgres"
  engine_version       = "15.4"
  family               = "postgres15"
  major_engine_version = "15"
  instance_class       = local.db_config.instance_class

  # Storage
  allocated_storage     = local.db_config.allocated_storage
  max_allocated_storage = local.db_config.max_allocated_storage
  storage_type          = var.environment == "production" ? "gp3" : "gp2"
  storage_throughput    = var.environment == "production" ? 125 : null
  storage_iops          = var.environment == "production" ? 3000 : null
  storage_encrypted     = var.enable_encryption
  kms_key_id           = aws_kms_key.rds.arn

  # Database
  db_name  = "fusion_bitcoin"
  username = "fusionbitcoin"
  password = random_password.db_password.result
  port     = 5432

  # Networking
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  publicly_accessible    = false

  # Multi-AZ and high availability
  multi_az               = local.db_config.multi_az
  availability_zone      = local.db_config.multi_az ? null : data.aws_availability_zones.available.names[0]

  # Backup
  backup_retention_period = local.db_config.backup_retention_period
  backup_window          = local.db_config.backup_window
  delete_automated_backups = true
  copy_tags_to_snapshot  = true
  skip_final_snapshot    = local.db_config.skip_final_snapshot
  final_snapshot_identifier = local.db_config.skip_final_snapshot ? null : "${local.name_prefix}-db-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"

  # Maintenance
  maintenance_window              = local.db_config.maintenance_window
  auto_minor_version_upgrade     = var.environment != "production"
  allow_major_version_upgrade    = false
  apply_immediately              = var.environment != "production"

  # Deletion protection
  deletion_protection = local.db_config.deletion_protection

  # Enhanced monitoring
  monitoring_interval = var.enable_enhanced_monitoring ? var.monitoring_interval : 0
  monitoring_role_arn = var.enable_enhanced_monitoring ? aws_iam_role.rds_enhanced_monitoring[0].arn : null

  # Performance Insights
  performance_insights_enabled = var.environment == "production"
  performance_insights_kms_key_id = var.environment == "production" ? aws_kms_key.rds.arn : null
  performance_insights_retention_period = var.environment == "production" ? 7 : null

  # Parameters and options
  parameter_group_name = aws_db_parameter_group.main.name
  option_group_name    = aws_db_option_group.main.name

  # Logging
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  cloudwatch_log_group_retention_in_days = var.environment == "production" ? 90 : 30

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db"
    Type = "RDSInstance"
  })
}

# Enhanced Monitoring IAM Role
resource "aws_iam_role" "rds_enhanced_monitoring" {
  count = var.enable_enhanced_monitoring ? 1 : 0
  
  name = "${local.name_prefix}-rds-enhanced-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-rds-enhanced-monitoring-role"
    Type = "IAMRole"
  })
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  count = var.enable_enhanced_monitoring ? 1 : 0
  
  role       = aws_iam_role.rds_enhanced_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# RDS Proxy for connection pooling (production only)
resource "aws_db_proxy" "main" {
  count = var.environment == "production" ? 1 : 0
  
  name                   = "${local.name_prefix}-db-proxy"
  engine_family         = "POSTGRESQL"
  auth {
    auth_scheme = "SECRETS"
    secret_arn  = aws_secretsmanager_secret.db_credentials.arn
  }
  
  role_arn               = aws_iam_role.db_proxy[0].arn
  vpc_subnet_ids         = module.vpc.database_subnets
  require_tls            = true
  
  target {
    db_instance_identifier = module.rds.db_instance_identifier
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-proxy"
    Type = "DBProxy"
  })
}

# IAM Role for RDS Proxy
resource "aws_iam_role" "db_proxy" {
  count = var.environment == "production" ? 1 : 0
  
  name = "${local.name_prefix}-db-proxy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "rds.amazonaws.com"
        }
      }
    ]
  })

  inline_policy {
    name = "SecretsManagerAccess"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect = "Allow"
          Action = [
            "secretsmanager:GetResourcePolicy",
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret",
            "secretsmanager:ListSecretVersionIds"
          ]
          Resource = aws_secretsmanager_secret.db_credentials.arn
        },
        {
          Effect = "Allow"
          Action = [
            "kms:Decrypt"
          ]
          Resource = aws_kms_key.rds.arn
          Condition = {
            StringEquals = {
              "kms:ViaService" = "secretsmanager.${data.aws_region.current.name}.amazonaws.com"
            }
          }
        }
      ]
    })
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-proxy-role"
    Type = "IAMRole"
  })
}

# Secrets Manager for database credentials
resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "${local.name_prefix}-db-credentials"
  description             = "Database credentials for ${local.name_prefix}"
  kms_key_id             = aws_kms_key.rds.arn
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-credentials"
    Type = "Secret"
  })
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = module.rds.db_instance_username
    password = random_password.db_password.result
    endpoint = module.rds.db_instance_endpoint
    port     = module.rds.db_instance_port
    dbname   = module.rds.db_instance_name
    engine   = "postgres"
  })
}

# CloudWatch Log Group for database logs
resource "aws_cloudwatch_log_group" "db_logs" {
  name              = "/aws/rds/instance/${local.name_prefix}-db/postgresql"
  retention_in_days = var.environment == "production" ? 90 : 30
  kms_key_id       = aws_kms_key.cloudwatch.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-logs"
    Type = "CloudWatchLogGroup"
  })
}

# Database migration job (runs once to set up schema)
resource "kubernetes_job" "db_migration" {
  count = var.environment != "local" ? 1 : 0
  
  metadata {
    name      = "fusion-bitcoin-db-migration"
    namespace = "fusion-bitcoin"
  }

  spec {
    template {
      metadata {}
      spec {
        restart_policy = "OnFailure"
        
        container {
          name  = "db-migration"
          image = "migrate/migrate:latest"
          
          command = [
            "sh", "-c",
            "migrate -path /migrations -database postgres://fusionbitcoin:${random_password.db_password.result}@${module.rds.db_instance_endpoint}:5432/fusion_bitcoin?sslmode=require up"
          ]
          
          volume_mount {
            name       = "migrations"
            mount_path = "/migrations"
          }
        }
        
        volume {
          name = "migrations"
          config_map {
            name = "fusion-bitcoin-db-migrations"
          }
        }
      }
    }
    
    backoff_limit = 3
  }

  wait_for_completion = true
  timeouts {
    create = "10m"
  }

  depends_on = [module.rds]
}

# Database backup schedule
resource "aws_backup_plan" "db_backup" {
  count = var.environment == "production" ? 1 : 0
  
  name = "${local.name_prefix}-db-backup-plan"

  rule {
    rule_name         = "daily_backup"
    target_vault_name = aws_backup_vault.main[0].name
    schedule          = "cron(0 2 * * ? *)"  # Daily at 2 AM

    lifecycle {
      cold_storage_after = 30
      delete_after       = 90
    }

    recovery_point_tags = merge(local.common_tags, {
      BackupType = "Daily"
    })
  }

  rule {
    rule_name         = "weekly_backup"
    target_vault_name = aws_backup_vault.main[0].name
    schedule          = "cron(0 1 ? * SUN *)"  # Weekly on Sunday at 1 AM

    lifecycle {
      cold_storage_after = 60
      delete_after       = 365
    }

    recovery_point_tags = merge(local.common_tags, {
      BackupType = "Weekly"
    })
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-backup-plan"
    Type = "BackupPlan"
  })
}

resource "aws_backup_vault" "main" {
  count = var.environment == "production" ? 1 : 0
  
  name        = "${local.name_prefix}-backup-vault"
  kms_key_arn = aws_kms_key.rds.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-backup-vault"
    Type = "BackupVault"
  })
}

resource "aws_backup_selection" "db_backup" {
  count = var.environment == "production" ? 1 : 0
  
  iam_role_arn = aws_iam_role.backup[0].arn
  name         = "${local.name_prefix}-db-backup-selection"
  plan_id      = aws_backup_plan.db_backup[0].id

  resources = [
    module.rds.db_instance_arn
  ]

  condition {
    string_equals {
      key   = "aws:ResourceTag/Environment"
      value = var.environment
    }
  }
}

resource "aws_iam_role" "backup" {
  count = var.environment == "production" ? 1 : 0
  
  name = "${local.name_prefix}-backup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "backup.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-backup-role"
    Type = "IAMRole"
  })
}

resource "aws_iam_role_policy_attachment" "backup" {
  count = var.environment == "production" ? 1 : 0
  
  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}