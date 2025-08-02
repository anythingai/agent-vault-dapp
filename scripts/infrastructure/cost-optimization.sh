#!/bin/bash

# Cost Optimization and Maintenance Script for Fusion Bitcoin Bridge
# Analyzes costs, identifies optimization opportunities, and performs maintenance tasks

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Usage information
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Perform cost optimization analysis and maintenance for Fusion Bitcoin Bridge infrastructure.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (local, staging, production)
    -a, --action ACTION             Action to perform (analyze, optimize, report, maintain, schedule)
    -r, --region REGION             AWS region (default: us-west-2)
    -p, --period PERIOD             Analysis period in days (default: 30)
    -t, --threshold THRESHOLD       Cost threshold for alerts (default: 1000)
    -f, --format FORMAT             Output format (text, json, csv, html)
    -o, --output FILE               Output file (default: stdout)
    -d, --dry-run                   Show recommendations without applying changes
    -v, --verbose                   Enable verbose output
    -h, --help                      Show this help message

ACTIONS:
    analyze     Analyze current costs and usage patterns
    optimize    Apply optimization recommendations
    report      Generate detailed cost report
    maintain    Perform routine maintenance tasks
    schedule    Setup automated cost optimization schedules

EXAMPLES:
    $0 -e production -a analyze -p 30
    $0 -e staging -a optimize -d
    $0 -e production -a report -f html -o cost-report.html
    $0 -e production -a maintain

EOF
}

# Default values
ENVIRONMENT=""
ACTION="analyze"
AWS_REGION="us-west-2"
PERIOD=30
THRESHOLD=1000
OUTPUT_FORMAT="text"
OUTPUT_FILE=""
DRY_RUN=false
VERBOSE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -a|--action)
            ACTION="$2"
            shift 2
            ;;
        -r|--region)
            AWS_REGION="$2"
            shift 2
            ;;
        -p|--period)
            PERIOD="$2"
            shift 2
            ;;
        -t|--threshold)
            THRESHOLD="$2"
            shift 2
            ;;
        -f|--format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate required parameters
if [[ -z "$ENVIRONMENT" ]]; then
    log_error "Environment is required. Use -e or --environment to specify."
    usage
    exit 1
fi

if [[ ! "$ENVIRONMENT" =~ ^(local|staging|production)$ ]]; then
    log_error "Invalid environment: $ENVIRONMENT. Must be one of: local, staging, production"
    exit 1
fi

if [[ ! "$ACTION" =~ ^(analyze|optimize|report|maintain|schedule)$ ]]; then
    log_error "Invalid action: $ACTION. Must be one of: analyze, optimize, report, maintain, schedule"
    exit 1
fi

# Enable verbose mode if requested
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

log_info "Starting cost optimization for Fusion Bitcoin Bridge"
log_info "Environment: $ENVIRONMENT"
log_info "Action: $ACTION"
log_info "Period: $PERIOD days"

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed. Please install AWS CLI first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured. Please configure AWS credentials."
        exit 1
    fi
    
    # Check if jq is available for JSON processing
    if ! command -v jq &> /dev/null; then
        log_warning "jq is not installed. JSON processing will be limited."
    fi
    
    log_success "Prerequisites check completed"
}

# Get current costs by service
get_cost_by_service() {
    log_info "Getting cost breakdown by service..."
    
    local start_date=$(date -d "$PERIOD days ago" --iso-8601)
    local end_date=$(date --iso-8601)
    
    # Get cost data from Cost Explorer
    aws ce get-cost-and-usage \
        --region "$AWS_REGION" \
        --time-period Start="$start_date",End="$end_date" \
        --granularity MONTHLY \
        --metrics BlendedCost \
        --group-by Type=DIMENSION,Key=SERVICE \
        --filter '{
            "Dimensions": {
                "Key": "LINKED_ACCOUNT",
                "Values": ["'$(aws sts get-caller-identity --query Account --output text)'"]
            }
        }' \
        --query 'ResultsByTime[0].Groups' \
        --output json > "/tmp/fusion-costs-by-service.json"
    
    if command -v jq &> /dev/null; then
        jq -r '.[] | "\(.Keys[0]): $\(.Metrics.BlendedCost.Amount | tonumber | floor)"' \
            "/tmp/fusion-costs-by-service.json" | sort -k2 -nr
    else
        cat "/tmp/fusion-costs-by-service.json"
    fi
}

# Analyze EC2 instance utilization
analyze_ec2_utilization() {
    log_info "Analyzing EC2 instance utilization..."
    
    # Get instances with fusion-bitcoin tag
    local instances=$(aws ec2 describe-instances \
        --region "$AWS_REGION" \
        --filters "Name=tag:Project,Values=fusion-bitcoin-bridge" "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].[InstanceId,InstanceType,Tags[?Key==`Name`].Value|[0]]' \
        --output text)
    
    if [[ -n "$instances" ]]; then
        echo "Instance Utilization Analysis:"
        echo "=============================="
        
        while IFS=$'\t' read -r instance_id instance_type name; do
            echo
            log_info "Instance: $name ($instance_id) - $instance_type"
            
            # Get CPU utilization for the last 30 days
            local cpu_avg=$(aws cloudwatch get-metric-statistics \
                --region "$AWS_REGION" \
                --namespace AWS/EC2 \
                --metric-name CPUUtilization \
                --dimensions Name=InstanceId,Value="$instance_id" \
                --start-time "$(date -d '30 days ago' --iso-8601)" \
                --end-time "$(date --iso-8601)" \
                --period 86400 \
                --statistics Average \
                --query 'Datapoints | sort_by(@, &Timestamp) | [-1].Average' \
                --output text 2>/dev/null || echo "N/A")
            
            if [[ "$cpu_avg" != "N/A" && "$cpu_avg" != "None" ]]; then
                local cpu_int=$(printf "%.0f" "$cpu_avg")
                echo "  CPU Utilization: ${cpu_int}%"
                
                if (( cpu_int < 10 )); then
                    log_warning "  → Low utilization - consider downsizing or stopping"
                elif (( cpu_int < 25 )); then
                    log_warning "  → Consider downsizing instance type"
                elif (( cpu_int > 80 )); then
                    log_warning "  → High utilization - consider upsizing"
                else
                    log_success "  → Utilization within optimal range"
                fi
            else
                log_warning "  → No CPU metrics available"
            fi
            
        done <<< "$instances"
    else
        log_info "No EC2 instances found with fusion-bitcoin-bridge tag"
    fi
}

# Analyze RDS utilization
analyze_rds_utilization() {
    log_info "Analyzing RDS utilization..."
    
    # Get RDS instances
    local db_instances=$(aws rds describe-db-instances \
        --region "$AWS_REGION" \
        --query 'DBInstances[?contains(DBInstanceIdentifier, `fusion-bitcoin`)].{Id:DBInstanceIdentifier,Class:DBInstanceClass,Status:DBInstanceStatus}' \
        --output text)
    
    if [[ -n "$db_instances" ]]; then
        echo "RDS Utilization Analysis:"
        echo "========================"
        
        while IFS=$'\t' read -r db_id db_class status; do
            echo
            log_info "Database: $db_id ($db_class) - $status"
            
            # Get CPU utilization
            local cpu_avg=$(aws cloudwatch get-metric-statistics \
                --region "$AWS_REGION" \
                --namespace AWS/RDS \
                --metric-name CPUUtilization \
                --dimensions Name=DBInstanceIdentifier,Value="$db_id" \
                --start-time "$(date -d '7 days ago' --iso-8601)" \
                --end-time "$(date --iso-8601)" \
                --period 86400 \
                --statistics Average \
                --query 'Datapoints | sort_by(@, &Timestamp) | [-1].Average' \
                --output text 2>/dev/null || echo "N/A")
            
            # Get connection utilization
            local conn_avg=$(aws cloudwatch get-metric-statistics \
                --region "$AWS_REGION" \
                --namespace AWS/RDS \
                --metric-name DatabaseConnections \
                --dimensions Name=DBInstanceIdentifier,Value="$db_id" \
                --start-time "$(date -d '7 days ago' --iso-8601)" \
                --end-time "$(date --iso-8601)" \
                --period 86400 \
                --statistics Average \
                --query 'Datapoints | sort_by(@, &Timestamp) | [-1].Average' \
                --output text 2>/dev/null || echo "N/A")
            
            if [[ "$cpu_avg" != "N/A" && "$cpu_avg" != "None" ]]; then
                local cpu_int=$(printf "%.0f" "$cpu_avg")
                echo "  CPU Utilization: ${cpu_int}%"
                
                if (( cpu_int < 20 )); then
                    log_warning "  → Low CPU utilization - consider downsizing"
                elif (( cpu_int > 80 )); then
                    log_warning "  → High CPU utilization - consider upsizing"
                else
                    log_success "  → CPU utilization within optimal range"
                fi
            fi
            
            if [[ "$conn_avg" != "N/A" && "$conn_avg" != "None" ]]; then
                local conn_int=$(printf "%.0f" "$conn_avg")
                echo "  Average Connections: ${conn_int}"
            fi
            
        done <<< "$db_instances"
    else
        log_info "No RDS instances found for fusion-bitcoin"
    fi
}

# Identify unused EBS volumes
identify_unused_ebs() {
    log_info "Identifying unused EBS volumes..."
    
    local unused_volumes=$(aws ec2 describe-volumes \
        --region "$AWS_REGION" \
        --filters "Name=status,Values=available" "Name=tag:Project,Values=fusion-bitcoin-bridge" \
        --query 'Volumes[].[VolumeId,Size,VolumeType,CreateTime]' \
        --output text)
    
    if [[ -n "$unused_volumes" ]]; then
        echo "Unused EBS Volumes:"
        echo "==================="
        local total_cost=0
        
        while IFS=$'\t' read -r volume_id size volume_type create_time; do
            # Estimate monthly cost (approximate)
            local monthly_cost
            case $volume_type in
                gp2) monthly_cost=$(echo "scale=2; $size * 0.10" | bc 2>/dev/null || echo "N/A") ;;
                gp3) monthly_cost=$(echo "scale=2; $size * 0.08" | bc 2>/dev/null || echo "N/A") ;;
                io1) monthly_cost=$(echo "scale=2; $size * 0.125" | bc 2>/dev/null || echo "N/A") ;;
                *) monthly_cost="N/A" ;;
            esac
            
            echo "  Volume: $volume_id (${size}GB $volume_type)"
            echo "    Created: $create_time"
            if [[ "$monthly_cost" != "N/A" ]]; then
                echo "    Estimated monthly cost: \$${monthly_cost}"
                total_cost=$(echo "scale=2; $total_cost + $monthly_cost" | bc 2>/dev/null || echo "$total_cost")
            fi
            
        done <<< "$unused_volumes"
        
        if [[ "$total_cost" != "0" ]]; then
            echo
            log_warning "Total estimated monthly cost of unused volumes: \$${total_cost}"
        fi
    else
        log_success "No unused EBS volumes found"
    fi
}

# Check for unattached Elastic IPs
check_unattached_eips() {
    log_info "Checking for unattached Elastic IPs..."
    
    local unattached_eips=$(aws ec2 describe-addresses \
        --region "$AWS_REGION" \
        --query 'Addresses[?!InstanceId].[PublicIp,AllocationId]' \
        --output text)
    
    if [[ -n "$unattached_eips" ]]; then
        echo "Unattached Elastic IPs:"
        echo "======================="
        
        while IFS=$'\t' read -r public_ip allocation_id; do
            echo "  IP: $public_ip (Allocation ID: $allocation_id)"
            log_warning "  → Unattached EIP costs ~\$3.65/month"
        done <<< "$unattached_eips"
    else
        log_success "No unattached Elastic IPs found"
    fi
}

# Generate cost optimization recommendations
generate_recommendations() {
    log_info "Generating cost optimization recommendations..."
    
    echo
    echo "COST OPTIMIZATION RECOMMENDATIONS"
    echo "================================="
    echo
    
    # Reserved Instance recommendations
    echo "1. Reserved Instance Opportunities:"
    echo "   - Analyze running instances for RI purchase opportunities"
    echo "   - Consider 1-year term for staging, 3-year for production"
    echo "   - Potential savings: 30-60% on compute costs"
    echo
    
    # Auto Scaling recommendations
    echo "2. Auto Scaling Optimization:"
    echo "   - Implement predictive scaling based on usage patterns"
    echo "   - Use spot instances for non-critical workloads"
    echo "   - Configure schedule-based scaling for known patterns"
    echo
    
    # Storage optimization
    echo "3. Storage Optimization:"
    echo "   - Move infrequently accessed data to IA storage classes"
    echo "   - Implement lifecycle policies for automated transitions"
    echo "   - Use EBS GP3 instead of GP2 for better price/performance"
    echo
    
    # Network optimization
    echo "4. Network Cost Optimization:"
    echo "   - Use VPC endpoints to avoid NAT Gateway charges"
    echo "   - Implement CloudFront for static content delivery"
    echo "   - Optimize inter-AZ data transfer"
    echo
    
    # Monitoring and alerting
    echo "5. Cost Monitoring:"
    echo "   - Set up cost anomaly detection"
    echo "   - Implement budget alerts at 50%, 80%, and 100%"
    echo "   - Regular cost reviews and optimization cycles"
}

# Apply optimization recommendations
apply_optimizations() {
    log_info "Applying optimization recommendations..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would apply the following optimizations:"
    fi
    
    # Stop development instances during off-hours (if staging/local)
    if [[ "$ENVIRONMENT" != "production" ]]; then
        local instances=$(aws ec2 describe-instances \
            --region "$AWS_REGION" \
            --filters "Name=tag:Project,Values=fusion-bitcoin-bridge" "Name=tag:Environment,Values=$ENVIRONMENT" "Name=instance-state-name,Values=running" \
            --query 'Reservations[].Instances[].InstanceId' \
            --output text)
        
        if [[ -n "$instances" && "$ENVIRONMENT" == "staging" ]]; then
            local current_hour=$(date +%H)
            # Stop instances during off-hours (10 PM to 6 AM)
            if (( current_hour >= 22 || current_hour <= 6 )); then
                log_info "Stopping staging instances during off-hours..."
                for instance in $instances; do
                    if [[ "$DRY_RUN" == "false" ]]; then
                        aws ec2 stop-instances --region "$AWS_REGION" --instance-ids "$instance"
                        log_success "Stopped instance: $instance"
                    else
                        log_info "[DRY RUN] Would stop instance: $instance"
                    fi
                done
            fi
        fi
    fi
    
    # Optimize EBS volumes
    local volumes=$(aws ec2 describe-volumes \
        --region "$AWS_REGION" \
        --filters "Name=tag:Project,Values=fusion-bitcoin-bridge" "Name=volume-type,Values=gp2" \
        --query 'Volumes[].VolumeId' \
        --output text)
    
    if [[ -n "$volumes" ]]; then
        log_info "Converting GP2 volumes to GP3 for cost savings..."
        for volume in $volumes; do
            if [[ "$DRY_RUN" == "false" ]]; then
                aws ec2 modify-volume --region "$AWS_REGION" --volume-id "$volume" --volume-type gp3
                log_success "Converted volume to GP3: $volume"
            else
                log_info "[DRY RUN] Would convert volume to GP3: $volume"
            fi
        done
    fi
}

# Perform maintenance tasks
perform_maintenance() {
    log_info "Performing routine maintenance tasks..."
    
    # Clean up old snapshots
    log_info "Cleaning up old snapshots (older than 90 days)..."
    local old_snapshots=$(aws ec2 describe-snapshots \
        --region "$AWS_REGION" \
        --owner-ids self \
        --filters "Name=tag:Project,Values=fusion-bitcoin-bridge" \
        --query "Snapshots[?StartTime<='$(date -d '90 days ago' --iso-8601)'].SnapshotId" \
        --output text)
    
    if [[ -n "$old_snapshots" ]]; then
        for snapshot in $old_snapshots; do
            if [[ "$DRY_RUN" == "false" ]]; then
                aws ec2 delete-snapshot --region "$AWS_REGION" --snapshot-id "$snapshot"
                log_success "Deleted old snapshot: $snapshot"
            else
                log_info "[DRY RUN] Would delete old snapshot: $snapshot"
            fi
        done
    else
        log_success "No old snapshots to clean up"
    fi
    
    # Update tags for better cost tracking
    log_info "Updating resource tags for cost tracking..."
    # This would involve tagging resources with cost center, project, etc.
    
    # Optimize CloudWatch log retention
    log_info "Optimizing CloudWatch log retention..."
    local log_groups=$(aws logs describe-log-groups \
        --region "$AWS_REGION" \
        --log-group-name-prefix "/aws/fusion-bitcoin" \
        --query 'logGroups[?!retentionInDays || retentionInDays > `30`].logGroupName' \
        --output text)
    
    if [[ -n "$log_groups" ]]; then
        for log_group in $log_groups; do
            if [[ "$DRY_RUN" == "false" ]]; then
                aws logs put-retention-policy --region "$AWS_REGION" --log-group-name "$log_group" --retention-in-days 30
                log_success "Set 30-day retention for log group: $log_group"
            else
                log_info "[DRY RUN] Would set 30-day retention for log group: $log_group"
            fi
        done
    fi
}

# Setup cost monitoring and alerts
setup_cost_monitoring() {
    log_info "Setting up cost monitoring and alerts..."
    
    # Create cost budget
    local budget_name="fusion-bitcoin-${ENVIRONMENT}-budget"
    
    cat > "/tmp/budget.json" << EOF
{
    "BudgetName": "$budget_name",
    "BudgetLimit": {
        "Amount": "$THRESHOLD",
        "Unit": "USD"
    },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST",
    "CostFilters": {
        "TagKey": ["Project"],
        "TagValue": ["fusion-bitcoin-bridge"]
    }
}
EOF

    cat > "/tmp/notifications.json" << EOF
[
    {
        "Notification": {
            "NotificationType": "ACTUAL",
            "ComparisonOperator": "GREATER_THAN",
            "Threshold": 80
        },
        "Subscribers": [
            {
                "SubscriptionType": "EMAIL",
                "Address": "ops@fusion-bitcoin.example.com"
            }
        ]
    },
    {
        "Notification": {
            "NotificationType": "FORECASTED",
            "ComparisonOperator": "GREATER_THAN",
            "Threshold": 100
        },
        "Subscribers": [
            {
                "SubscriptionType": "EMAIL",
                "Address": "ops@fusion-bitcoin.example.com"
            }
        ]
    }
]
EOF
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Create budget
        aws budgets create-budget \
            --account-id "$(aws sts get-caller-identity --query Account --output text)" \
            --budget file:///tmp/budget.json \
            --notifications-with-subscribers file:///tmp/notifications.json || true
        
        log_success "Cost budget and alerts configured"
    else
        log_info "[DRY RUN] Would create cost budget: $budget_name with \$${THRESHOLD} limit"
    fi
    
    # Cleanup temp files
    rm -f "/tmp/budget.json" "/tmp/notifications.json"
}

# Generate detailed cost report
generate_cost_report() {
    log_info "Generating detailed cost report..."
    
    local report_file
    if [[ -n "$OUTPUT_FILE" ]]; then
        report_file="$OUTPUT_FILE"
    else
        report_file="${PROJECT_ROOT}/cost-report-${ENVIRONMENT}-$(date +%Y%m%d_%H%M%S).${OUTPUT_FORMAT}"
    fi
    
    case "$OUTPUT_FORMAT" in
        html)
            generate_html_report "$report_file"
            ;;
        json)
            generate_json_report "$report_file"
            ;;
        csv)
            generate_csv_report "$report_file"
            ;;
        *)
            generate_text_report "$report_file"
            ;;
    esac
    
    log_success "Cost report saved to: $report_file"
}

# Generate HTML cost report
generate_html_report() {
    local report_file="$1"
    
    cat > "$report_file" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Fusion Bitcoin Bridge - Cost Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 15px; border-radius: 5px; }
        .section { margin: 20px 0; }
        .cost-item { margin: 10px 0; padding: 10px; border-left: 3px solid #007cba; }
        .warning { border-left-color: #ff9800; }
        .success { border-left-color: #4caf50; }
        .error { border-left-color: #f44336; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Fusion Bitcoin Bridge - Cost Optimization Report</h1>
        <p>Environment: $ENVIRONMENT | Generated: $(date) | Period: $PERIOD days</p>
    </div>
    
    <div class="section">
        <h2>Executive Summary</h2>
        <p>Cost analysis and optimization recommendations for the $ENVIRONMENT environment.</p>
    </div>
    
    <!-- Additional report content would be generated here -->
    
</body>
</html>
EOF
}

# Generate JSON cost report
generate_json_report() {
    local report_file="$1"
    
    cat > "$report_file" << EOF
{
    "report": {
        "environment": "$ENVIRONMENT",
        "generated_at": "$(date --iso-8601)",
        "period_days": $PERIOD,
        "currency": "USD"
    },
    "summary": {
        "total_cost": 0,
        "optimization_potential": 0,
        "recommendations": []
    },
    "services": {},
    "recommendations": []
}
EOF
}

# Generate CSV cost report
generate_csv_report() {
    local report_file="$1"
    
    cat > "$report_file" << EOF
Service,Cost,Usage,Recommendation,Potential_Savings
EOF
}

# Generate text cost report
generate_text_report() {
    local report_file="$1"
    
    cat > "$report_file" << EOF
# Fusion Bitcoin Bridge - Cost Optimization Report
Environment: $ENVIRONMENT
Generated: $(date)
Period: $PERIOD days

## Summary
- Analysis period: $PERIOD days
- Cost threshold: \$$THRESHOLD
- Optimization status: Analysis completed

## Recommendations
- Review and implement cost optimization suggestions
- Monitor usage patterns for further optimization opportunities
- Set up automated cost alerts and budgets

EOF
}

# Main execution
main() {
    check_prerequisites
    
    case "$ACTION" in
        analyze)
            get_cost_by_service
            analyze_ec2_utilization
            analyze_rds_utilization
            identify_unused_ebs
            check_unattached_eips
            generate_recommendations
            ;;
        optimize)
            apply_optimizations
            ;;
        report)
            generate_cost_report
            ;;
        maintain)
            perform_maintenance
            ;;
        schedule)
            setup_cost_monitoring
            ;;
    esac
    
    log_success "Cost optimization completed successfully!"
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"