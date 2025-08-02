# Application Load Balancer Configuration for Fusion Bitcoin Bridge
# Creates ALB, target groups, and listeners for routing traffic to EKS services

# Application Load Balancer
module "alb" {
  source = "terraform-aws-modules/alb/aws"
  version = "~> 8.0"

  name = "${local.name_prefix}-alb"
  
  load_balancer_type = "application"
  internal           = false

  # Networking
  vpc_id  = module.vpc.vpc_id
  subnets = module.vpc.public_subnets
  security_groups = [aws_security_group.alb.id]

  # Access logs
  access_logs = var.environment != "local" ? {
    bucket  = module.s3_logs.s3_bucket_id
    prefix  = "alb-access-logs"
    enabled = true
  } : {}

  # Enable deletion protection for production
  enable_deletion_protection = var.environment == "production" ? var.enable_deletion_protection : false

  # Enable HTTP/2
  enable_http2 = true

  # Target groups
  target_groups = [
    {
      name             = "${local.name_prefix}-relayer-tg"
      backend_protocol = "HTTP"
      backend_port     = 3000
      target_type      = "ip"
      
      health_check = {
        enabled             = true
        healthy_threshold   = 2
        unhealthy_threshold = 3
        timeout             = 5
        interval            = 30
        path                = "/health"
        matcher             = "200"
        port                = "traffic-port"
        protocol            = "HTTP"
      }

      tags = merge(local.common_tags, {
        Name = "${local.name_prefix}-relayer-tg"
        Service = "relayer"
      })
    },
    {
      name             = "${local.name_prefix}-resolver-tg"
      backend_protocol = "HTTP"
      backend_port     = 3001
      target_type      = "ip"
      
      health_check = {
        enabled             = true
        healthy_threshold   = 2
        unhealthy_threshold = 3
        timeout             = 5
        interval            = 30
        path                = "/health"
        matcher             = "200"
        port                = "traffic-port"
        protocol            = "HTTP"
      }

      tags = merge(local.common_tags, {
        Name = "${local.name_prefix}-resolver-tg"
        Service = "resolver"
      })
    },
    {
      name             = "${local.name_prefix}-frontend-tg"
      backend_protocol = "HTTP"
      backend_port     = 3002
      target_type      = "ip"
      
      health_check = {
        enabled             = true
        healthy_threshold   = 2
        unhealthy_threshold = 3
        timeout             = 5
        interval            = 30
        path                = "/health"
        matcher             = "200"
        port                = "traffic-port"
        protocol            = "HTTP"
      }

      tags = merge(local.common_tags, {
        Name = "${local.name_prefix}-frontend-tg"
        Service = "frontend"
      })
    }
  ]

  # HTTP Listener (redirects to HTTPS)
  http_tcp_listeners = [
    {
      port        = 80
      protocol    = "HTTP"
      action_type = "redirect"
      redirect = {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  ]

  # HTTPS Listener
  https_listeners = var.certificate_arn != "" ? [
    {
      port               = 443
      protocol           = "HTTPS"
      certificate_arn    = var.certificate_arn
      ssl_policy         = "ELBSecurityPolicy-TLS-1-2-2017-01"
      action_type        = "forward"
      target_group_index = 2  # Frontend target group
    }
  ] : []

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-alb"
    Type = "ApplicationLoadBalancer"
  })
}

# Route53 record for ALB (if domain is provided)
data "aws_route53_zone" "main" {
  count = var.certificate_arn != "" && var.domain_name != "" ? 1 : 0
  
  name         = replace(var.domain_name, "/^[^.]+\\./", "")
  private_zone = false
}

resource "aws_route53_record" "main" {
  count = var.certificate_arn != "" && var.domain_name != "" ? 1 : 0
  
  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.alb.lb_dns_name
    zone_id                = module.alb.lb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  count = var.certificate_arn != "" && var.domain_name != "" ? 1 : 0
  
  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = module.alb.lb_dns_name
    zone_id                = module.alb.lb_zone_id
    evaluate_target_health = true
  }
}

# CloudWatch Alarms for ALB
resource "aws_cloudwatch_metric_alarm" "alb_response_time" {
  count = var.environment != "local" ? 1 : 0
  
  alarm_name          = "${local.name_prefix}-alb-response-time"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = "300"
  statistic           = "Average"
  threshold           = "1.0"
  alarm_description   = "This metric monitors ALB response time"

  dimensions = {
    LoadBalancer = module.alb.lb_arn_suffix
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-alb-response-time-alarm"
    Type = "CloudWatchAlarm"
  })
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx_errors" {
  count = var.environment != "local" ? 1 : 0
  
  alarm_name          = "${local.name_prefix}-alb-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = "300"
  statistic           = "Sum"
  threshold           = "5"
  alarm_description   = "This metric monitors ALB 5XX errors"

  dimensions = {
    LoadBalancer = module.alb.lb_arn_suffix
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-alb-5xx-errors-alarm"
    Type = "CloudWatchAlarm"
  })
}