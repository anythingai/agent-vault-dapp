# CloudWatch and Monitoring Configuration for Fusion Bitcoin Bridge
# Creates CloudWatch log groups, dashboards, and monitoring resources

# KMS Key for CloudWatch Logs encryption
resource "aws_kms_key" "cloudwatch" {
  description             = "CloudWatch Logs encryption key for ${local.name_prefix}"
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
        Sid    = "Allow CloudWatch Logs"
        Effect = "Allow"
        Principal = {
          Service = "logs.${data.aws_region.current.name}.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = "*"
        Condition = {
          ArnEquals = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/fusion-bitcoin/*"
          }
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cloudwatch-key"
    Type = "KMSKey"
  })
}

resource "aws_kms_alias" "cloudwatch" {
  name          = "alias/${local.name_prefix}-cloudwatch"
  target_key_id = aws_kms_key.cloudwatch.key_id
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "application" {
  for_each = toset([
    "relayer",
    "resolver", 
    "frontend"
  ])
  
  name              = "/aws/fusion-bitcoin/${var.environment}/${each.key}"
  retention_in_days = var.environment == "production" ? 90 : 30
  kms_key_id       = aws_kms_key.cloudwatch.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-${each.key}-logs"
    Type = "CloudWatchLogGroup"
    Service = each.key
  })
}

resource "aws_cloudwatch_log_group" "infrastructure" {
  for_each = toset([
    "vpc-flow-logs",
    "alb-access-logs",
    "waf-logs"
  ])
  
  name              = "/aws/fusion-bitcoin/${var.environment}/infrastructure/${each.key}"
  retention_in_days = var.environment == "production" ? 90 : 30
  kms_key_id       = aws_kms_key.cloudwatch.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-${each.key}"
    Type = "CloudWatchLogGroup"
    Purpose = "Infrastructure"
  })
}

# CloudWatch Dashboard
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.name_prefix}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", module.alb.lb_arn_suffix],
            [".", "TargetResponseTime", ".", "."],
            [".", "HTTPCode_ELB_5XX_Count", ".", "."],
            [".", "HTTPCode_ELB_4XX_Count", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "Application Load Balancer Metrics"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/EKS", "cluster_failed_request_count", "cluster_name", module.eks.cluster_name],
            [".", "cluster_request_total", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "EKS Cluster Metrics"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", module.rds.db_instance_identifier],
            [".", "DatabaseConnections", ".", "."],
            [".", "FreeableMemory", ".", "."],
            [".", "ReadLatency", ".", "."],
            [".", "WriteLatency", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "RDS Database Metrics"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 6
        width  = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/ElastiCache", "CPUUtilization", "CacheClusterId", module.elasticache.cluster_id],
            [".", "CurrConnections", ".", "."],
            [".", "DatabaseMemoryUsagePercentage", ".", "."],
            [".", "NetworkBytesIn", ".", "."],
            [".", "NetworkBytesOut", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "ElastiCache Redis Metrics"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 6
        width  = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", var.cloudfront_enabled ? module.cloudfront[0].cloudfront_distribution_id : ""],
            [".", "BytesDownloaded", ".", "."],
            [".", "4xxErrorRate", ".", "."],
            [".", "5xxErrorRate", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = "us-east-1"  # CloudFront metrics are only in us-east-1
          title   = "CloudFront Distribution Metrics"
          period  = 300
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 12
        width  = 24
        height = 6
        properties = {
          query   = "SOURCE '/aws/fusion-bitcoin/${var.environment}/relayer' | fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 100"
          region  = data.aws_region.current.name
          title   = "Recent Error Logs"
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dashboard"
    Type = "CloudWatchDashboard"
  })
}

# CloudWatch Composite Alarms
resource "aws_cloudwatch_composite_alarm" "application_health" {
  count = var.environment != "local" ? 1 : 0
  
  alarm_name        = "${local.name_prefix}-application-health"
  alarm_description = "Composite alarm for overall application health"
  
  alarm_rule = join(" OR ", [
    "ALARM('${aws_cloudwatch_metric_alarm.alb_5xx_errors[0].alarm_name}')",
    "ALARM('${aws_cloudwatch_metric_alarm.alb_response_time[0].alarm_name}')",
    var.enable_enhanced_monitoring ? "ALARM('${aws_cloudwatch_metric_alarm.redis_cpu[0].alarm_name}')" : "",
    var.enable_enhanced_monitoring ? "ALARM('${aws_cloudwatch_metric_alarm.redis_memory[0].alarm_name}')" : ""
  ])

  actions_enabled = true
  ok_actions     = []
  alarm_actions  = []

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-application-health-alarm"
    Type = "CloudWatchCompositeAlarm"
  })
}

# CloudWatch Insights Queries
resource "aws_cloudwatch_query_definition" "error_analysis" {
  name = "${local.name_prefix}-error-analysis"

  log_group_names = [
    aws_cloudwatch_log_group.application["relayer"].name,
    aws_cloudwatch_log_group.application["resolver"].name,
    aws_cloudwatch_log_group.application["frontend"].name
  ]

  query_string = <<-EOT
fields @timestamp, @message, @logStream
| filter @message like /ERROR/
| stats count() by bin(5m)
| sort @timestamp desc
EOT

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-error-analysis-query"
    Type = "CloudWatchInsightsQuery"
  })
}

resource "aws_cloudwatch_query_definition" "performance_analysis" {
  name = "${local.name_prefix}-performance-analysis"

  log_group_names = [
    aws_cloudwatch_log_group.application["relayer"].name,
    aws_cloudwatch_log_group.application["resolver"].name
  ]

  query_string = <<-EOT
fields @timestamp, @message, @requestId, @duration
| filter @type = "REPORT"
| stats avg(@duration), max(@duration), min(@duration) by bin(5m)
| sort @timestamp desc
EOT

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-performance-analysis-query"
    Type = "CloudWatchInsightsQuery"
  })
}

# SNS Topics for Alerts
resource "aws_sns_topic" "critical_alerts" {
  count = var.environment == "production" ? 1 : 0
  
  name = "${local.name_prefix}-critical-alerts"
  kms_master_key_id = aws_kms_key.cloudwatch.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-critical-alerts"
    Type = "SNSTopic"
  })
}

resource "aws_sns_topic" "warning_alerts" {
  count = var.environment != "local" ? 1 : 0
  
  name = "${local.name_prefix}-warning-alerts"
  kms_master_key_id = aws_kms_key.cloudwatch.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-warning-alerts"
    Type = "SNSTopic"
  })
}

# CloudWatch Event Rules for automated responses
resource "aws_cloudwatch_event_rule" "auto_scaling_events" {
  count = var.environment != "local" ? 1 : 0
  
  name        = "${local.name_prefix}-auto-scaling-events"
  description = "Capture auto scaling events"

  event_pattern = jsonencode({
    source      = ["aws.autoscaling"]
    detail-type = ["EC2 Instance Launch Successful", "EC2 Instance Terminate Successful"]
    detail = {
      AutoScalingGroupName = [
        {
          prefix = local.name_prefix
        }
      ]
    }
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-auto-scaling-events"
    Type = "CloudWatchEventRule"
  })
}

resource "aws_cloudwatch_event_target" "sns" {
  count = var.environment != "local" ? 1 : 0
  
  rule      = aws_cloudwatch_event_rule.auto_scaling_events[0].name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.warning_alerts[0].arn
}

# X-Ray Tracing (for application performance monitoring)
resource "aws_xray_sampling_rule" "main" {
  count = var.environment != "local" ? 1 : 0
  
  rule_name      = "${local.name_prefix}-sampling-rule"
  priority       = 9000
  version        = 1
  reservoir_size = 1
  fixed_rate     = var.environment == "production" ? 0.1 : 0.5
  url_path       = "*"
  host           = "*"
  http_method    = "*"
  service_type   = "*"
  service_name   = "*"
  resource_arn   = "*"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-xray-sampling-rule"
    Type = "XRaySamplingRule"
  })
}

# EventBridge Custom Bus for application events
resource "aws_cloudwatch_event_bus" "main" {
  count = var.environment != "local" ? 1 : 0
  
  name = "${local.name_prefix}-event-bus"
  kms_key_id = aws_kms_key.cloudwatch.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-event-bus"
    Type = "EventBridge"
  })
}

# Custom Metrics Filters
resource "aws_cloudwatch_log_metric_filter" "error_count" {
  for_each = aws_cloudwatch_log_group.application

  name           = "${each.key}-error-count"
  log_group_name = each.value.name
  pattern        = "[timestamp, request_id, level=\"ERROR\", ...]"

  metric_transformation {
    name      = "ErrorCount"
    namespace = "FusionBitcoin/${title(each.key)}"
    value     = "1"
    
    default_value = 0
  }
}

resource "aws_cloudwatch_log_metric_filter" "response_time" {
  for_each = {
    relayer  = aws_cloudwatch_log_group.application["relayer"]
    resolver = aws_cloudwatch_log_group.application["resolver"]
  }

  name           = "${each.key}-response-time"
  log_group_name = each.value.name
  pattern        = "[timestamp, request_id, level, method, path, status, duration]"

  metric_transformation {
    name      = "ResponseTime"
    namespace = "FusionBitcoin/${title(each.key)}"
    value     = "$duration"
    
    default_value = 0
  }
}

# Application-specific alarms based on custom metrics
resource "aws_cloudwatch_metric_alarm" "high_error_rate" {
  for_each = aws_cloudwatch_log_group.application

  alarm_name          = "${local.name_prefix}-${each.key}-high-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "ErrorCount"
  namespace           = "FusionBitcoin/${title(each.key)}"
  period              = "300"
  statistic           = "Sum"
  threshold           = var.environment == "production" ? "10" : "20"
  alarm_description   = "High error rate detected in ${each.key} service"
  treat_missing_data  = "notBreaching"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-${each.key}-error-rate-alarm"
    Type = "CloudWatchAlarm"
    Service = each.key
  })
}