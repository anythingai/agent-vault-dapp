#!/bin/bash

# Infrastructure Cleanup Script for Fusion Bitcoin Bridge
# Cleans up and tears down infrastructure resources

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TERRAFORM_DIR="${PROJECT_ROOT}/infrastructure/terraform"

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

Clean up infrastructure resources for Fusion Bitcoin Bridge.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (local, staging, production)
    -t, --type TYPE                  Cleanup type (partial, full, orphaned)
    -r, --region REGION             AWS region (default: us-west-2)
    -f, --force                     Skip confirmation prompts
    -d, --dry-run                   Show what would be deleted without doing it
    -v, --verbose                   Enable verbose output
    -h, --help                      Show this help message

CLEANUP TYPES:
    partial     Clean up unused resources but keep infrastructure
    full        Complete teardown of all infrastructure
    orphaned    Only clean up orphaned/untagged resources

EXAMPLES:
    $0 -e staging -t partial
    $0 -e production -t orphaned -d
    $0 -e local -t full -f

EOF
}

# Default values
ENVIRONMENT=""
CLEANUP_TYPE="partial"
AWS_REGION="us-west-2"
FORCE=false
DRY_RUN=false
VERBOSE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -t|--type)
            CLEANUP_TYPE="$2"
            shift 2
            ;;
        -r|--region)
            AWS_REGION="$2"
            shift 2
            ;;
        -f|--force)
            FORCE=true
            shift
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

if [[ ! "$CLEANUP_TYPE" =~ ^(partial|full|orphaned)$ ]]; then
    log_error "Invalid cleanup type: $CLEANUP_TYPE. Must be one of: partial, full, orphaned"
    exit 1
fi

# Enable verbose mode if requested
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

log_info "Starting infrastructure cleanup for Fusion Bitcoin Bridge"
log_info "Environment: $ENVIRONMENT"
log_info "Cleanup Type: $CLEANUP_TYPE"
log_info "Region: $AWS_REGION"
log_info "Dry Run: $DRY_RUN"

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
    
    # Check if kubectl is installed
    if ! command -v kubectl &> /dev/null; then
        log_warning "kubectl is not installed. Kubernetes cleanup will be skipped."
    fi
    
    log_success "Prerequisites check completed"
}

# Clean up orphaned EBS volumes
cleanup_orphaned_ebs() {
    log_info "Cleaning up orphaned EBS volumes..."
    
    local volumes=$(aws ec2 describe-volumes \
        --region "$AWS_REGION" \
        --filters "Name=status,Values=available" "Name=tag:Project,Values=fusion-bitcoin-bridge" \
        --query 'Volumes[].VolumeId' \
        --output text)
    
    if [[ -n "$volumes" ]]; then
        for volume in $volumes; do
            log_info "Found orphaned volume: $volume"
            if [[ "$DRY_RUN" == "false" ]]; then
                aws ec2 delete-volume --region "$AWS_REGION" --volume-id "$volume" || true
                log_success "Deleted volume: $volume"
            else
                log_info "[DRY RUN] Would delete volume: $volume"
            fi
        done
    else
        log_info "No orphaned EBS volumes found"
    fi
}

# Clean up orphaned snapshots
cleanup_orphaned_snapshots() {
    log_info "Cleaning up old EBS snapshots..."
    
    # Find snapshots older than 30 days with fusion-bitcoin tag
    local cutoff_date=$(date -d '30 days ago' --iso-8601)
    local snapshots=$(aws ec2 describe-snapshots \
        --region "$AWS_REGION" \
        --owner-ids self \
        --filters "Name=tag:Project,Values=fusion-bitcoin-bridge" \
        --query "Snapshots[?StartTime<='${cutoff_date}'].SnapshotId" \
        --output text)
    
    if [[ -n "$snapshots" ]]; then
        for snapshot in $snapshots; do
            log_info "Found old snapshot: $snapshot"
            if [[ "$DRY_RUN" == "false" ]]; then
                aws ec2 delete-snapshot --region "$AWS_REGION" --snapshot-id "$snapshot" || true
                log_success "Deleted snapshot: $snapshot"
            else
                log_info "[DRY RUN] Would delete snapshot: $snapshot"
            fi
        done
    else
        log_info "No old snapshots found"
    fi
}

# Clean up unused security groups
cleanup_unused_security_groups() {
    log_info "Cleaning up unused security groups..."
    
    # Get all security groups with fusion-bitcoin tag
    local sgs=$(aws ec2 describe-security-groups \
        --region "$AWS_REGION" \
        --filters "Name=tag:Project,Values=fusion-bitcoin-bridge" \
        --query 'SecurityGroups[].GroupId' \
        --output text)
    
    for sg in $sgs; do
        # Check if security group is attached to any instances or load balancers
        local in_use=$(aws ec2 describe-instances \
            --region "$AWS_REGION" \
            --filters "Name=instance.group-id,Values=$sg" "Name=instance-state-name,Values=running,pending,stopping,stopped" \
            --query 'Reservations[].Instances[].InstanceId' \
            --output text)
        
        if [[ -z "$in_use" ]]; then
            # Check if it's referenced by other security groups
            local referenced=$(aws ec2 describe-security-groups \
                --region "$AWS_REGION" \
                --filters "Name=ip-permission.group-id,Values=$sg" \
                --query 'SecurityGroups[].GroupId' \
                --output text)
            
            if [[ -z "$referenced" ]]; then
                log_info "Found unused security group: $sg"
                if [[ "$DRY_RUN" == "false" ]]; then
                    aws ec2 delete-security-group --region "$AWS_REGION" --group-id "$sg" || true
                    log_success "Deleted security group: $sg"
                else
                    log_info "[DRY RUN] Would delete security group: $sg"
                fi
            fi
        fi
    done
}

# Clean up old CloudWatch log groups
cleanup_old_log_groups() {
    log_info "Cleaning up old CloudWatch log groups..."
    
    # Get log groups for the project
    local log_groups=$(aws logs describe-log-groups \
        --region "$AWS_REGION" \
        --log-group-name-prefix "/aws/fusion-bitcoin" \
        --query 'logGroups[].logGroupName' \
        --output text)
    
    for log_group in $log_groups; do
        # Check if log group has been inactive for more than 30 days
        local last_event=$(aws logs describe-log-streams \
            --region "$AWS_REGION" \
            --log-group-name "$log_group" \
            --order-by LastEventTime \
            --descending \
            --max-items 1 \
            --query 'logStreams[0].lastEventTime' \
            --output text 2>/dev/null || echo "0")
        
        if [[ "$last_event" != "None" && "$last_event" != "0" ]]; then
            local last_event_date=$(date -d "@$((last_event/1000))" --iso-8601)
            local cutoff_date=$(date -d '30 days ago' --iso-8601)
            
            if [[ "$last_event_date" < "$cutoff_date" ]]; then
                log_info "Found inactive log group: $log_group (last event: $last_event_date)"
                if [[ "$DRY_RUN" == "false" ]]; then
                    aws logs delete-log-group --region "$AWS_REGION" --log-group-name "$log_group" || true
                    log_success "Deleted log group: $log_group"
                else
                    log_info "[DRY RUN] Would delete log group: $log_group"
                fi
            fi
        fi
    done
}

# Clean up unused S3 buckets
cleanup_unused_s3_buckets() {
    log_info "Cleaning up unused S3 buckets..."
    
    # Get all buckets with fusion-bitcoin tag
    local buckets=$(aws s3api list-buckets \
        --query 'Buckets[].Name' \
        --output text | grep "fusion-bitcoin" || true)
    
    for bucket in $buckets; do
        # Check if bucket is empty and unused
        local object_count=$(aws s3api list-objects-v2 \
            --bucket "$bucket" \
            --query 'KeyCount' \
            --output text 2>/dev/null || echo "0")
        
        if [[ "$object_count" == "0" ]]; then
            # Check bucket tags to see if it's for the current environment
            local bucket_env=$(aws s3api get-bucket-tagging \
                --bucket "$bucket" \
                --query 'TagSet[?Key==`Environment`].Value' \
                --output text 2>/dev/null || echo "")
            
            if [[ "$bucket_env" == "$ENVIRONMENT" || -z "$bucket_env" ]]; then
                log_info "Found empty bucket: $bucket"
                if [[ "$DRY_RUN" == "false" ]]; then
                    aws s3 rb "s3://$bucket" --force || true
                    log_success "Deleted bucket: $bucket"
                else
                    log_info "[DRY RUN] Would delete bucket: $bucket"
                fi
            fi
        fi
    done
}

# Clean up Kubernetes resources
cleanup_kubernetes_resources() {
    if ! command -v kubectl &> /dev/null; then
        log_warning "kubectl not available, skipping Kubernetes cleanup"
        return
    fi
    
    log_info "Cleaning up Kubernetes resources..."
    
    local namespace="fusion-bitcoin"
    if [[ "$ENVIRONMENT" != "production" ]]; then
        namespace="fusion-bitcoin-${ENVIRONMENT}"
    fi
    
    # Clean up completed jobs
    if [[ "$DRY_RUN" == "false" ]]; then
        kubectl delete jobs --field-selector status.successful=1 -n "$namespace" --ignore-not-found=true || true
    else
        log_info "[DRY RUN] Would delete completed jobs in namespace: $namespace"
    fi
    
    # Clean up failed pods
    if [[ "$DRY_RUN" == "false" ]]; then
        kubectl delete pods --field-selector status.phase=Failed -n "$namespace" --ignore-not-found=true || true
    else
        log_info "[DRY RUN] Would delete failed pods in namespace: $namespace"
    fi
    
    log_success "Kubernetes cleanup completed"
}

# Confirmation prompt
confirm_cleanup() {
    if [[ "$FORCE" == "true" ]]; then
        return 0
    fi
    
    echo
    log_warning "You are about to perform $CLEANUP_TYPE cleanup for environment: $ENVIRONMENT"
    
    if [[ "$CLEANUP_TYPE" == "full" ]]; then
        log_error "WARNING: Full cleanup will destroy ALL infrastructure!"
        log_error "This action is IRREVERSIBLE!"
        
        if [[ "$ENVIRONMENT" == "production" ]]; then
            read -p "Type 'DESTROY PRODUCTION' to confirm: " -r
            if [[ "$REPLY" != "DESTROY PRODUCTION" ]]; then
                log_info "Operation cancelled"
                exit 0
            fi
        fi
    fi
    
    read -p "Do you want to continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "Operation cancelled"
        exit 0
    fi
}

# Full infrastructure teardown
full_teardown() {
    log_error "Performing full infrastructure teardown..."
    
    # Run Terraform destroy
    cd "$TERRAFORM_DIR"
    
    local tfvars_file="environments/${ENVIRONMENT}.tfvars"
    
    if [[ -f "$tfvars_file" ]]; then
        terraform init -upgrade
        
        if [[ "$DRY_RUN" == "false" ]]; then
            terraform destroy \
                -var-file="$tfvars_file" \
                -var="aws_region=$AWS_REGION" \
                -auto-approve
            log_success "Infrastructure destroyed"
        else
            terraform plan -destroy \
                -var-file="$tfvars_file" \
                -var="aws_region=$AWS_REGION"
            log_info "[DRY RUN] Would destroy infrastructure"
        fi
    else
        log_error "Environment file not found: $tfvars_file"
    fi
}

# Generate cleanup report
generate_report() {
    log_info "Generating cleanup report..."
    
    local report_file="${PROJECT_ROOT}/cleanup-report-${ENVIRONMENT}-$(date +%Y%m%d_%H%M%S).txt"
    
    cat > "$report_file" << EOF
# Infrastructure Cleanup Report
Environment: $ENVIRONMENT
Cleanup Type: $CLEANUP_TYPE
Date: $(date)
Region: $AWS_REGION
Dry Run: $DRY_RUN

## Resources Processed
EOF
    
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "Note: This was a dry run - no actual resources were deleted" >> "$report_file"
    fi
    
    log_success "Cleanup report saved to: $report_file"
}

# Main execution
main() {
    check_prerequisites
    confirm_cleanup
    
    case "$CLEANUP_TYPE" in
        partial)
            cleanup_orphaned_ebs
            cleanup_orphaned_snapshots
            cleanup_unused_security_groups
            cleanup_old_log_groups
            cleanup_kubernetes_resources
            ;;
        full)
            cleanup_kubernetes_resources
            full_teardown
            ;;
        orphaned)
            cleanup_orphaned_ebs
            cleanup_orphaned_snapshots
            cleanup_unused_security_groups
            cleanup_old_log_groups
            cleanup_unused_s3_buckets
            ;;
    esac
    
    generate_report
    log_success "Infrastructure cleanup completed successfully!"
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"