# ElastiCache Redis Configuration for Fusion Bitcoin Bridge
# Creates Redis cluster, subnet group, parameter group, and related resources

# KMS Key for Redis encryption
resource "aws_kms_key" "redis" {
  description             = "ElastiCache Redis encryption key for ${local.name_prefix}"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-key"
    Type = "KMSKey"
  })
}

resource "aws_kms_alias" "redis" {
  name          = "alias/${local.name_prefix}-redis"
  target_key_id = aws_kms_key.redis.key_id
}

# ElastiCache Subnet Group
resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-redis-subnet-group"
  subnet_ids = module.vpc.database_subnets

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-subnet-group"
    Type = "ElastiCacheSubnetGroup"
  })
}

# ElastiCache Parameter Group
resource "aws_elasticache_parameter_group" "main" {
  family = "redis7.x"
  name   = "${local.name_prefix}-redis-params"

  # Memory management
  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  # Persistence settings
  parameter {
    name  = "save"
    value = var.environment == "production" ? "900 1 300 10 60 10000" : "60 1000"
  }

  # Connection timeout
  parameter {
    name  = "timeout"
    value = "300"
  }

  # TCP keepalive
  parameter {
    name  = "tcp-keepalive"
    value = "300"
  }

  # Slow log settings
  parameter {
    name  = "slowlog-log-slower-than"
    value = "10000"  # 10ms
  }

  parameter {
    name  = "slowlog-max-len"
    value = "1024"
  }

  # Client output buffer limits
  parameter {
    name  = "client-output-buffer-limit-normal-hard-limit"
    value = "0"
  }

  parameter {
    name  = "client-output-buffer-limit-normal-soft-limit"
    value = "0"
  }

  parameter {
    name  = "client-output-buffer-limit-replica-hard-limit"
    value = "268435456"  # 256MB
  }

  parameter {
    name  = "client-output-buffer-limit-replica-soft-limit"
    value = "67108864"   # 64MB
  }

  # Notify keyspace events (for pub/sub)
  parameter {
    name  = "notify-keyspace-events"
    value = "Ex"  # Expired events
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-params"
    Type = "ElastiCacheParameterGroup"
  })
}

# ElastiCache Replication Group (Redis Cluster)
module "elasticache" {
  source = "terraform-aws-modules/elasticache/aws"
  version = "~> 1.0"

  # Cluster configuration
  cluster_id         = "${local.name_prefix}-redis"
  description        = "Redis cluster for ${local.name_prefix}"
  node_type          = local.redis_config.node_type
  port               = local.redis_config.port
  parameter_group_name = aws_elasticache_parameter_group.main.name

  # Engine version
  engine_version = "7.0"

  # Replication settings
  num_cache_clusters = local.redis_config.num_cache_nodes
  replicas_per_node_group = var.environment == "production" ? 1 : 0
  num_node_groups = var.environment == "production" ? 2 : 1

  # Multi-AZ
  multi_az_enabled = var.environment == "production"
  automatic_failover_enabled = var.environment == "production"

  # Networking
  subnet_group_name = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  # Security
  at_rest_encryption_enabled = local.redis_config.at_rest_encryption_enabled
  transit_encryption_enabled = local.redis_config.transit_encryption_enabled
  auth_token = local.redis_config.transit_encryption_enabled ? random_password.redis_password.result : null
  kms_key_id = local.redis_config.at_rest_encryption_enabled ? aws_kms_key.redis.arn : null

  # Backup
  snapshot_retention_limit = var.environment == "production" ? 7 : 1
  snapshot_window         = "03:00-05:00"
  final_snapshot_identifier = "${local.name_prefix}-redis-final-snapshot"

  # Maintenance
  maintenance_window = "sun:05:00-sun:07:00"
  auto_minor_version_upgrade = var.environment != "production"

  # Logging
  log_delivery_configuration = var.environment == "production" ? [
    {
      destination      = aws_cloudwatch_log_group.redis_slow[0].name
      destination_type = "cloudwatch-logs"
      log_format      = "text"
      log_type        = "slow-log"
    }
  ] : []

  # Notification
  notification_topic_arn = var.environment == "production" ? aws_sns_topic.alerts[0].arn : null

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis"
    Type = "ElastiCacheReplicationGroup"
  })
}

# CloudWatch Log Group for Redis slow logs (production only)
resource "aws_cloudwatch_log_group" "redis_slow" {
  count = var.environment == "production" ? 1 : 0
  
  name              = "/aws/elasticache/${local.name_prefix}-redis/slow-log"
  retention_in_days = 30
  kms_key_id       = aws_kms_key.cloudwatch.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-slow-logs"
    Type = "CloudWatchLogGroup"
  })
}

# SNS Topic for Redis alerts (production only)
resource "aws_sns_topic" "alerts" {
  count = var.environment == "production" ? 1 : 0
  
  name = "${local.name_prefix}-redis-alerts"
  kms_master_key_id = aws_kms_key.redis.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-alerts"
    Type = "SNSTopic"
  })
}

# ElastiCache User for authentication (if auth token is enabled)
resource "aws_elasticache_user" "main" {
  count = local.redis_config.transit_encryption_enabled ? 1 : 0
  
  user_id       = "fusion-bitcoin-user"
  user_name     = "fusion-bitcoin"
  access_string = "on ~* &* +@all"
  engine        = "REDIS"
  passwords     = [random_password.redis_password.result]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-user"
    Type = "ElastiCacheUser"
  })
}

resource "aws_elasticache_user_group" "main" {
  count = local.redis_config.transit_encryption_enabled ? 1 : 0
  
  engine        = "REDIS"
  user_group_id = "${local.name_prefix}-redis-user-group"
  user_ids      = ["default", aws_elasticache_user.main[0].user_id]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-user-group"
    Type = "ElastiCacheUserGroup"
  })
}

# Secrets Manager for Redis credentials
resource "aws_secretsmanager_secret" "redis_credentials" {
  name                    = "${local.name_prefix}-redis-credentials"
  description             = "Redis credentials for ${local.name_prefix}"
  kms_key_id             = aws_kms_key.redis.arn
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-credentials"
    Type = "Secret"
  })
}

resource "aws_secretsmanager_secret_version" "redis_credentials" {
  secret_id = aws_secretsmanager_secret.redis_credentials.id
  secret_string = jsonencode({
    password = random_password.redis_password.result
    endpoint = module.elasticache.primary_endpoint_address
    port     = local.redis_config.port
    auth_token = local.redis_config.transit_encryption_enabled ? random_password.redis_password.result : null
  })
}

# CloudWatch Alarms for Redis monitoring
resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  count = var.environment != "local" ? 1 : 0
  
  alarm_name          = "${local.name_prefix}-redis-cpu-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "This metric monitors ElastiCache CPU utilization"
  
  dimensions = {
    CacheClusterId = module.elasticache.cluster_id
  }

  alarm_actions = var.environment == "production" ? [aws_sns_topic.alerts[0].arn] : []
  ok_actions    = var.environment == "production" ? [aws_sns_topic.alerts[0].arn] : []

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-cpu-alarm"
    Type = "CloudWatchAlarm"
  })
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  count = var.environment != "local" ? 1 : 0
  
  alarm_name          = "${local.name_prefix}-redis-memory-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = "300"
  statistic           = "Average"
  threshold           = "90"
  alarm_description   = "This metric monitors ElastiCache memory utilization"
  
  dimensions = {
    CacheClusterId = module.elasticache.cluster_id
  }

  alarm_actions = var.environment == "production" ? [aws_sns_topic.alerts[0].arn] : []
  ok_actions    = var.environment == "production" ? [aws_sns_topic.alerts[0].arn] : []

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-memory-alarm"
    Type = "CloudWatchAlarm"
  })
}

resource "aws_cloudwatch_metric_alarm" "redis_connections" {
  count = var.environment != "local" ? 1 : 0
  
  alarm_name          = "${local.name_prefix}-redis-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CurrConnections"
  namespace           = "AWS/ElastiCache"
  period              = "300"
  statistic           = "Average"
  threshold           = "500"
  alarm_description   = "This metric monitors ElastiCache connections"
  
  dimensions = {
    CacheClusterId = module.elasticache.cluster_id
  }

  alarm_actions = var.environment == "production" ? [aws_sns_topic.alerts[0].arn] : []
  ok_actions    = var.environment == "production" ? [aws_sns_topic.alerts[0].arn] : []

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-connections-alarm"
    Type = "CloudWatchAlarm"
  })
}

resource "aws_cloudwatch_metric_alarm" "redis_evictions" {
  count = var.environment != "local" ? 1 : 0
  
  alarm_name          = "${local.name_prefix}-redis-evictions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = "300"
  statistic           = "Sum"
  threshold           = "0"
  alarm_description   = "This metric monitors ElastiCache evictions"
  treat_missing_data  = "notBreaching"
  
  dimensions = {
    CacheClusterId = module.elasticache.cluster_id
  }

  alarm_actions = var.environment == "production" ? [aws_sns_topic.alerts[0].arn] : []

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-evictions-alarm"
    Type = "CloudWatchAlarm"
  })
}

# Redis Client Test Job (runs to verify connectivity)
resource "kubernetes_job" "redis_test" {
  count = var.environment != "local" ? 1 : 0
  
  metadata {
    name      = "fusion-bitcoin-redis-test"
    namespace = "fusion-bitcoin"
  }

  spec {
    template {
      metadata {}
      spec {
        restart_policy = "OnFailure"
        
        container {
          name  = "redis-test"
          image = "redis:7-alpine"
          
          command = [
            "sh", "-c",
            local.redis_config.transit_encryption_enabled ? 
            "redis-cli -h ${module.elasticache.primary_endpoint_address} -p ${local.redis_config.port} --tls -a ${random_password.redis_password.result} ping" :
            "redis-cli -h ${module.elasticache.primary_endpoint_address} -p ${local.redis_config.port} ping"
          ]
          
          env {
            name = "REDIS_HOST"
            value = module.elasticache.primary_endpoint_address
          }
          
          env {
            name = "REDIS_PORT"
            value = tostring(local.redis_config.port)
          }
          
          dynamic "env" {
            for_each = local.redis_config.transit_encryption_enabled ? [1] : []
            content {
              name = "REDIS_PASSWORD"
              value_from {
                secret_key_ref {
                  name = "fusion-bitcoin-redis-secret"
                  key  = "password"
                }
              }
            }
          }
        }
      }
    }
    
    backoff_limit = 3
  }

  wait_for_completion = true
  timeouts {
    create = "5m"
  }

  depends_on = [module.elasticache]
}

# Redis configuration for Kubernetes
resource "kubernetes_config_map" "redis_config" {
  metadata {
    name      = "fusion-bitcoin-redis-config"
    namespace = "fusion-bitcoin"
  }

  data = {
    redis_host = module.elasticache.primary_endpoint_address
    redis_port = tostring(local.redis_config.port)
    redis_ssl  = tostring(local.redis_config.transit_encryption_enabled)
    redis_db   = "0"
  }

  depends_on = [module.elasticache]
}

# Redis Sentinel configuration for high availability (production only)
resource "aws_elasticache_replication_group" "redis_sentinel" {
  count = var.environment == "production" ? 1 : 0
  
  replication_group_id       = "${local.name_prefix}-redis-sentinel"
  description               = "Redis Sentinel cluster for ${local.name_prefix}"
  
  port                     = 26379
  parameter_group_name     = "default.redis7.x"
  node_type               = "cache.t3.micro"
  num_cache_clusters      = 3

  subnet_group_name       = aws_elasticache_subnet_group.main.name
  security_group_ids      = [aws_security_group.redis.id]
  
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  kms_key_id                = aws_kms_key.redis.arn
  
  auto_minor_version_upgrade = false
  maintenance_window        = "sun:07:00-sun:08:00"
  
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-sentinel"
    Type = "ElastiCacheReplicationGroup"
  })
}

# Output Redis connection information
output "redis_endpoint" {
  description = "Redis cluster endpoint"
  value       = module.elasticache.primary_endpoint_address
  sensitive   = true
}

output "redis_port" {
  description = "Redis cluster port"
  value       = local.redis_config.port
}

output "redis_auth_token_required" {
  description = "Whether Redis requires authentication"
  value       = local.redis_config.transit_encryption_enabled
}