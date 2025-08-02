#!/bin/bash

# Backup and Disaster Recovery Script for Fusion Bitcoin Bridge
# Handles automated backups, disaster recovery procedures, and data restoration

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
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

Backup and disaster recovery management for Fusion Bitcoin Bridge infrastructure.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (local, staging, production)
    -a, --action ACTION             Action to perform (backup, restore, test, schedule, disaster-recovery)
    -t, --type TYPE                 Backup type (full, incremental, database, application, infrastructure)
    -r, --region REGION             Primary AWS region (default: us-west-2)
    -R, --backup-region REGION      Backup AWS region (default: us-east-1)
    -s, --storage STORAGE           Storage backend (s3, local, both)
    -k, --keep-days DAYS            Retention period in days (default: 30)
    -c, --compression               Enable compression for backups
    -p, --parallel                  Enable parallel backup operations
    -f, --force                     Skip confirmation prompts
    -v, --verbose                   Enable verbose output
    -n, --dry-run                   Show what would be done without executing
    -h, --help                      Show this help message

ACTIONS:
    backup              Create backups of specified resources
    restore             Restore from backups
    test                Test backup integrity and restore procedures
    schedule            Setup automated backup schedules
    disaster-recovery   Execute disaster recovery procedures

BACKUP TYPES:
    full               Complete backup of all components
    incremental        Incremental backup since last full backup
    database           Database backups only (PostgreSQL, Redis)
    application        Application data and configurations
    infrastructure     Terraform state and infrastructure configs

STORAGE BACKENDS:
    s3                 AWS S3 (recommended for production)
    local              Local filesystem
    both               Both S3 and local

EXAMPLES:
    $0 -e production -a backup -t full -s s3
    $0 -e staging -a restore -t database
    $0 -e production -a test -v
    $0 -e production -a disaster-recovery

EOF
}

# Default values
ENVIRONMENT=""
ACTION="backup"
BACKUP_TYPE="full"
PRIMARY_REGION="us-west-2"
BACKUP_REGION="us-east-1"
STORAGE_BACKEND="s3"
KEEP_DAYS=30
COMPRESSION=false
PARALLEL=false
FORCE=false
VERBOSE=false
DRY_RUN=false

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
        -t|--type)
            BACKUP_TYPE="$2"
            shift 2
            ;;
        -r|--region)
            PRIMARY_REGION="$2"
            shift 2
            ;;
        -R|--backup-region)
            BACKUP_REGION="$2"
            shift 2
            ;;
        -s|--storage)
            STORAGE_BACKEND="$2"
            shift 2
            ;;
        -k|--keep-days)
            KEEP_DAYS="$2"
            shift 2
            ;;
        -c|--compression)
            COMPRESSION=true
            shift
            ;;
        -p|--parallel)
            PARALLEL=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -n|--dry-run)
            DRY_RUN=true
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

if [[ ! "$ACTION" =~ ^(backup|restore|test|schedule|disaster-recovery)$ ]]; then
    log_error "Invalid action: $ACTION. Must be one of: backup, restore, test, schedule, disaster-recovery"
    exit 1
fi

if [[ ! "$BACKUP_TYPE" =~ ^(full|incremental|database|application|infrastructure)$ ]]; then
    log_error "Invalid backup type: $BACKUP_TYPE. Must be one of: full, incremental, database, application, infrastructure"
    exit 1
fi

if [[ ! "$STORAGE_BACKEND" =~ ^(s3|local|both)$ ]]; then
    log_error "Invalid storage backend: $STORAGE_BACKEND. Must be one of: s3, local, both"
    exit 1
fi

# Enable verbose mode if requested
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

# Global variables
BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PREFIX="fusion-bitcoin-${ENVIRONMENT}-${BACKUP_TIMESTAMP}"
S3_BUCKET="fusion-bitcoin-backups-${ENVIRONMENT}"

log_info "Starting backup and disaster recovery operations"
log_info "Environment: $ENVIRONMENT"
log_info "Action: $ACTION"
log_info "Backup Type: $BACKUP_TYPE"
log_info "Storage Backend: $STORAGE_BACKEND"

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check required tools
    local required_tools=("aws")
    local optional_tools=("pg_dump" "redis-cli" "kubectl" "terraform" "gzip" "tar")
    
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "$tool is required but not installed"
            exit 1
        fi
    done
    
    for tool in "${optional_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_warning "$tool is not installed (may be needed for some operations)"
        fi
    done
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured"
        exit 1
    fi
    
    # Create backup directories
    mkdir -p "${BACKUP_DIR}"/{database,application,infrastructure,logs}
    
    # Check S3 bucket exists (for S3 storage)
    if [[ "$STORAGE_BACKEND" =~ ^(s3|both)$ ]]; then
        if ! aws s3 ls "s3://$S3_BUCKET" &> /dev/null; then
            log_info "Creating S3 backup bucket: $S3_BUCKET"
            if [[ "$DRY_RUN" == "false" ]]; then
                aws s3 mb "s3://$S3_BUCKET" --region "$PRIMARY_REGION"
                
                # Enable versioning
                aws s3api put-bucket-versioning \
                    --bucket "$S3_BUCKET" \
                    --versioning-configuration Status=Enabled
                
                # Setup lifecycle policy
                cat > /tmp/lifecycle.json << EOF
{
    "Rules": [
        {
            "ID": "backup-lifecycle",
            "Status": "Enabled",
            "Filter": {"Prefix": ""},
            "Transitions": [
                {
                    "Days": 30,
                    "StorageClass": "STANDARD_IA"
                },
                {
                    "Days": 90,
                    "StorageClass": "GLACIER"
                },
                {
                    "Days": 365,
                    "StorageClass": "DEEP_ARCHIVE"
                }
            ]
        }
    ]
}
EOF
                aws s3api put-bucket-lifecycle-configuration \
                    --bucket "$S3_BUCKET" \
                    --lifecycle-configuration file:///tmp/lifecycle.json
                rm -f /tmp/lifecycle.json
            fi
        fi
    fi
    
    log_success "Prerequisites check completed"
}

# Database backup functions
backup_postgresql() {
    log_info "Backing up PostgreSQL database..."
    
    local db_host=""
    local db_name="fusion_bitcoin"
    local db_user="fusionbitcoin"
    
    case $ENVIRONMENT in
        "local")
            db_host="localhost"
            ;;
        "staging")
            db_host="fusion-bitcoin-staging-db.us-west-2.rds.amazonaws.com"
            ;;
        "production")
            db_host="fusion-bitcoin-prod-db.us-west-2.rds.amazonaws.com"
            ;;
    esac
    
    local backup_file="${BACKUP_DIR}/database/postgresql-${BACKUP_PREFIX}.sql"
    local compressed_file="${backup_file}.gz"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would backup PostgreSQL to: $backup_file"
        return
    fi
    
    # Create database dump
    if command -v pg_dump &> /dev/null; then
        PGPASSWORD="${DB_PASSWORD:-}" pg_dump \
            -h "$db_host" \
            -U "$db_user" \
            -d "$db_name" \
            --verbose \
            --no-owner \
            --no-acl \
            --clean \
            --if-exists \
            > "$backup_file"
        
        # Compress if requested
        if [[ "$COMPRESSION" == "true" ]]; then
            gzip "$backup_file"
            backup_file="$compressed_file"
        fi
        
        local file_size=$(du -h "$backup_file" | cut -f1)
        log_success "PostgreSQL backup completed: $backup_file ($file_size)"
        
        # Upload to S3 if configured
        upload_to_s3 "$backup_file" "database/"
        
    else
        log_warning "pg_dump not available, skipping PostgreSQL backup"
    fi
}

# Redis backup function
backup_redis() {
    log_info "Backing up Redis data..."
    
    local redis_host=""
    local redis_port=6379
    
    case $ENVIRONMENT in
        "local")
            redis_host="localhost"
            ;;
        "staging")
            redis_host="fusion-bitcoin-staging-redis.abc123.cache.amazonaws.com"
            ;;
        "production")
            redis_host="fusion-bitcoin-prod-redis.xyz789.cache.amazonaws.com"
            ;;
    esac
    
    local backup_file="${BACKUP_DIR}/database/redis-${BACKUP_PREFIX}.rdb"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would backup Redis to: $backup_file"
        return
    fi
    
    if command -v redis-cli &> /dev/null; then
        # Create Redis dump
        redis-cli -h "$redis_host" -p "$redis_port" --rdb "$backup_file"
        
        # Compress if requested
        if [[ "$COMPRESSION" == "true" ]]; then
            gzip "$backup_file"
            backup_file="${backup_file}.gz"
        fi
        
        local file_size=$(du -h "$backup_file" | cut -f1)
        log_success "Redis backup completed: $backup_file ($file_size)"
        
        # Upload to S3 if configured
        upload_to_s3 "$backup_file" "database/"
        
    else
        log_warning "redis-cli not available, skipping Redis backup"
    fi
}

# Kubernetes backup function
backup_kubernetes() {
    log_info "Backing up Kubernetes resources..."
    
    if ! command -v kubectl &> /dev/null; then
        log_warning "kubectl not available, skipping Kubernetes backup"
        return
    fi
    
    local namespace="fusion-bitcoin"
    if [[ "$ENVIRONMENT" != "production" ]]; then
        namespace="fusion-bitcoin-${ENVIRONMENT}"
    fi
    
    local backup_file="${BACKUP_DIR}/application/kubernetes-${BACKUP_PREFIX}.yaml"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would backup Kubernetes resources to: $backup_file"
        return
    fi
    
    # Check if cluster is accessible
    if ! kubectl cluster-info &> /dev/null; then
        log_warning "Kubernetes cluster not accessible, skipping K8s backup"
        return
    fi
    
    # Backup all resources in namespace
    {
        echo "# Kubernetes Backup - $(date)"
        echo "# Environment: $ENVIRONMENT"
        echo "# Namespace: $namespace"
        echo "---"
        
        # Get all resources except pods (they are ephemeral)
        kubectl get all,configmaps,secrets,pvc,ingress -n "$namespace" -o yaml --export 2>/dev/null || \
        kubectl get all,configmaps,secrets,pvc,ingress -n "$namespace" -o yaml
        
    } > "$backup_file"
    
    # Compress if requested
    if [[ "$COMPRESSION" == "true" ]]; then
        gzip "$backup_file"
        backup_file="${backup_file}.gz"
    fi
    
    local file_size=$(du -h "$backup_file" | cut -f1)
    log_success "Kubernetes backup completed: $backup_file ($file_size)"
    
    # Upload to S3 if configured
    upload_to_s3 "$backup_file" "application/"
}

# Terraform state backup
backup_terraform_state() {
    log_info "Backing up Terraform state..."
    
    if [[ ! -d "$TERRAFORM_DIR" ]]; then
        log_warning "Terraform directory not found, skipping state backup"
        return
    fi
    
    local backup_file="${BACKUP_DIR}/infrastructure/terraform-state-${BACKUP_PREFIX}.tar.gz"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would backup Terraform state to: $backup_file"
        return
    fi
    
    cd "$TERRAFORM_DIR"
    
    # Create archive of Terraform configuration and state
    tar -czf "$backup_file" \
        --exclude='.terraform' \
        --exclude='*.tfplan' \
        --exclude='terraform.tfstate.backup' \
        .
    
    # Also backup remote state if using S3 backend
    local state_bucket="fusion-bitcoin-terraform-state-${ENVIRONMENT}"
    local state_backup_file="${BACKUP_DIR}/infrastructure/terraform-remote-state-${BACKUP_PREFIX}.tfstate"
    
    if aws s3 ls "s3://$state_bucket/infrastructure/terraform.tfstate" &> /dev/null; then
        aws s3 cp "s3://$state_bucket/infrastructure/terraform.tfstate" "$state_backup_file"
        
        if [[ "$COMPRESSION" == "true" ]]; then
            gzip "$state_backup_file"
            state_backup_file="${state_backup_file}.gz"
        fi
        
        upload_to_s3 "$state_backup_file" "infrastructure/"
    fi
    
    local file_size=$(du -h "$backup_file" | cut -f1)
    log_success "Terraform state backup completed: $backup_file ($file_size)"
    
    upload_to_s3 "$backup_file" "infrastructure/"
}

# Application configuration backup
backup_application_configs() {
    log_info "Backing up application configurations..."
    
    local backup_file="${BACKUP_DIR}/application/configs-${BACKUP_PREFIX}.tar.gz"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would backup configurations to: $backup_file"
        return
    fi
    
    # Create archive of configuration files
    tar -czf "$backup_file" \
        -C "$PROJECT_ROOT" \
        config/ \
        .env.example \
        docker-compose.yml \
        infrastructure/kubernetes/ \
        docs/ \
        2>/dev/null || true
    
    local file_size=$(du -h "$backup_file" | cut -f1)
    log_success "Application configuration backup completed: $backup_file ($file_size)"
    
    upload_to_s3 "$backup_file" "application/"
}

# Upload file to S3
upload_to_s3() {
    local file_path="$1"
    local s3_prefix="$2"
    
    if [[ "$STORAGE_BACKEND" =~ ^(s3|both)$ ]] && [[ -f "$file_path" ]]; then
        local s3_key="${s3_prefix}$(basename "$file_path")"
        
        log_info "Uploading to S3: s3://$S3_BUCKET/$s3_key"
        
        aws s3 cp "$file_path" "s3://$S3_BUCKET/$s3_key" \
            --storage-class STANDARD_IA \
            --metadata "environment=$ENVIRONMENT,backup-type=$BACKUP_TYPE,timestamp=$BACKUP_TIMESTAMP"
        
        # Cross-region replication if backup region is different
        if [[ "$BACKUP_REGION" != "$PRIMARY_REGION" ]]; then
            local backup_bucket="fusion-bitcoin-backups-${ENVIRONMENT}-${BACKUP_REGION}"
            aws s3 cp "s3://$S3_BUCKET/$s3_key" "s3://$backup_bucket/$s3_key" \
                --source-region "$PRIMARY_REGION" \
                --region "$BACKUP_REGION" || log_warning "Cross-region replication failed"
        fi
    fi
}

# Cleanup old backups
cleanup_old_backups() {
    log_info "Cleaning up old backups (keeping last $KEEP_DAYS days)..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would cleanup backups older than $KEEP_DAYS days"
        return
    fi
    
    # Cleanup local backups
    if [[ "$STORAGE_BACKEND" =~ ^(local|both)$ ]]; then
        find "$BACKUP_DIR" -type f -mtime +$KEEP_DAYS -delete 2>/dev/null || true
    fi
    
    # Cleanup S3 backups (handled by lifecycle policy, but can be done manually)
    if [[ "$STORAGE_BACKEND" =~ ^(s3|both)$ ]]; then
        local cutoff_date=$(date -d "$KEEP_DAYS days ago" --iso-8601)
        
        aws s3api list-objects-v2 \
            --bucket "$S3_BUCKET" \
            --query "Contents[?LastModified<=\`$cutoff_date\`].[Key]" \
            --output text | while read -r key; do
            if [[ -n "$key" && "$key" != "None" ]]; then
                aws s3 rm "s3://$S3_BUCKET/$key"
                log_info "Deleted old backup: $key"
            fi
        done
    fi
}

# Main backup orchestration
perform_backup() {
    log_info "Performing $BACKUP_TYPE backup..."
    
    case "$BACKUP_TYPE" in
        full)
            if [[ "$PARALLEL" == "true" ]]; then
                {
                    backup_postgresql &
                    backup_redis &
                    backup_kubernetes &
                    backup_terraform_state &
                    backup_application_configs &
                    wait
                }
            else
                backup_postgresql
                backup_redis
                backup_kubernetes
                backup_terraform_state
                backup_application_configs
            fi
            ;;
        database)
            if [[ "$PARALLEL" == "true" ]]; then
                backup_postgresql &
                backup_redis &
                wait
            else
                backup_postgresql
                backup_redis
            fi
            ;;
        application)
            backup_kubernetes
            backup_application_configs
            ;;
        infrastructure)
            backup_terraform_state
            ;;
        incremental)
            # For incremental, we'd typically only backup changed files
            # This is a simplified implementation
            log_warning "Incremental backup not fully implemented, performing full backup"
            perform_backup
            BACKUP_TYPE="full"  # Reset for cleanup
            ;;
    esac
    
    cleanup_old_backups
    
    # Generate backup report
    generate_backup_report
}

# Generate backup report
generate_backup_report() {
    local report_file="${BACKUP_DIR}/backup-report-${BACKUP_PREFIX}.txt"
    
    cat > "$report_file" << EOF
# Backup Report - Fusion Bitcoin Bridge
Environment: $ENVIRONMENT
Backup Type: $BACKUP_TYPE
Timestamp: $BACKUP_TIMESTAMP
Storage Backend: $STORAGE_BACKEND

## Backup Summary
EOF
    
    if ls "${BACKUP_DIR}"/database/*${BACKUP_PREFIX}* &> /dev/null; then
        echo "- Database backups: $(ls "${BACKUP_DIR}"/database/*${BACKUP_PREFIX}* | wc -l) files" >> "$report_file"
    fi
    
    if ls "${BACKUP_DIR}"/application/*${BACKUP_PREFIX}* &> /dev/null; then
        echo "- Application backups: $(ls "${BACKUP_DIR}"/application/*${BACKUP_PREFIX}* | wc -l) files" >> "$report_file"
    fi
    
    if ls "${BACKUP_DIR}"/infrastructure/*${BACKUP_PREFIX}* &> /dev/null; then
        echo "- Infrastructure backups: $(ls "${BACKUP_DIR}"/infrastructure/*${BACKUP_PREFIX}* | wc -l) files" >> "$report_file"
    fi
    
    echo "" >> "$report_file"
    echo "## File Details" >> "$report_file"
    find "$BACKUP_DIR" -name "*${BACKUP_PREFIX}*" -exec ls -lh {} \; >> "$report_file"
    
    log_success "Backup report generated: $report_file"
    
    # Upload report to S3
    upload_to_s3 "$report_file" "reports/"
}

# Restore functions
restore_postgresql() {
    local restore_file="$1"
    
    log_warning "Restoring PostgreSQL database from: $restore_file"
    
    if [[ "$FORCE" == "false" ]]; then
        read -p "This will overwrite the current database. Continue? (yes/no): " -r
        if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            log_info "Restore cancelled"
            return
        fi
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would restore PostgreSQL from: $restore_file"
        return
    fi
    
    # Implementation would depend on specific environment and restore requirements
    log_error "PostgreSQL restore functionality needs to be implemented based on specific requirements"
}

# Test backup integrity
test_backup_integrity() {
    log_info "Testing backup integrity..."
    
    local test_results=()
    
    # Test database backups
    for backup_file in "${BACKUP_DIR}"/database/*.sql*; do
        if [[ -f "$backup_file" ]]; then
            if [[ "$backup_file" =~ \.gz$ ]]; then
                if gzip -t "$backup_file" &> /dev/null; then
                    test_results+=("PASS: $backup_file - compression integrity OK")
                else
                    test_results+=("FAIL: $backup_file - compression integrity failed")
                fi
            else
                # Test SQL syntax
                if head -10 "$backup_file" | grep -q "PostgreSQL database dump" 2>/dev/null; then
                    test_results+=("PASS: $backup_file - PostgreSQL backup format OK")
                else
                    test_results+=("WARN: $backup_file - backup format uncertain")
                fi
            fi
        fi
    done
    
    # Test configuration backups
    for backup_file in "${BACKUP_DIR}"/application/*.tar.gz; do
        if [[ -f "$backup_file" ]]; then
            if tar -tzf "$backup_file" &> /dev/null; then
                test_results+=("PASS: $backup_file - archive integrity OK")
            else
                test_results+=("FAIL: $backup_file - archive integrity failed")
            fi
        fi
    done
    
    # Display results
    echo
    log_info "Backup Integrity Test Results:"
    echo "==============================="
    for result in "${test_results[@]}"; do
        if [[ "$result" =~ ^PASS ]]; then
            log_success "$result"
        elif [[ "$result" =~ ^FAIL ]]; then
            log_error "$result"
        else
            log_warning "$result"
        fi
    done
}

# Setup automated backup schedules
setup_backup_schedule() {
    log_info "Setting up automated backup schedules..."
    
    # Create backup script wrapper
    local wrapper_script="/usr/local/bin/fusion-bitcoin-backup"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would create backup schedule for $ENVIRONMENT environment"
        return
    fi
    
    # This would typically involve setting up cron jobs or AWS EventBridge rules
    cat << EOF
# Add the following to crontab for automated backups:
# Daily full backup at 2 AM
0 2 * * * $SCRIPT_DIR/$(basename "$0") -e $ENVIRONMENT -a backup -t full -s s3 -c

# Weekly infrastructure backup on Sundays at 3 AM  
0 3 * * 0 $SCRIPT_DIR/$(basename "$0") -e $ENVIRONMENT -a backup -t infrastructure -s s3 -c

# Monthly backup integrity test on 1st of month at 4 AM
0 4 1 * * $SCRIPT_DIR/$(basename "$0") -e $ENVIRONMENT -a test
EOF
    
    log_success "Backup schedule examples provided above"
}

# Disaster recovery procedures
execute_disaster_recovery() {
    log_error "DISASTER RECOVERY MODE ACTIVATED"
    log_error "Environment: $ENVIRONMENT"
    
    if [[ "$ENVIRONMENT" == "production" ]]; then
        log_error "Production disaster recovery requires manual intervention"
        log_error "Please follow the disaster recovery runbook"
        return
    fi
    
    if [[ "$FORCE" == "false" ]]; then
        read -p "This will execute disaster recovery procedures. Continue? (yes/no): " -r
        if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            log_info "Disaster recovery cancelled"
            return
        fi
    fi
    
    log_info "Executing disaster recovery procedures..."
    
    # 1. Verify backup availability
    log_info "Step 1: Verifying backup availability..."
    if [[ -d "$BACKUP_DIR" ]] && find "$BACKUP_DIR" -name "*.sql*" -o -name "*.tar.gz" | grep -q .; then
        log_success "Backups found locally"
    else
        log_warning "Local backups not found, checking S3..."
        if aws s3 ls "s3://$S3_BUCKET/" | grep -q .; then
            log_success "S3 backups found"
        else
            log_error "No backups found! Manual intervention required"
            return
        fi
    fi
    
    # 2. Infrastructure recovery
    log_info "Step 2: Infrastructure recovery..."
    if [[ -f "$TERRAFORM_DIR/main.tf" ]]; then
        log_info "Terraform configurations available for infrastructure recovery"
    else
        log_error "Terraform configurations not found!"
    fi
    
    # 3. Data recovery planning
    log_info "Step 3: Data recovery planning..."
    log_info "Latest database backup: $(ls -t "${BACKUP_DIR}"/database/*.sql* 2>/dev/null | head -1 || echo 'None found locally')"
    
    # 4. Service recovery
    log_info "Step 4: Service recovery planning..."
    if command -v kubectl &> /dev/null && kubectl cluster-info &> /dev/null; then
        log_success "Kubernetes cluster accessible for service recovery"
    else
        log_warning "Kubernetes cluster not accessible"
    fi
    
    log_success "Disaster recovery assessment completed"
    log_info "Next steps:"
    log_info "1. Review backup integrity"
    log_info "2. Restore infrastructure using Terraform"
    log_info "3. Restore database from latest backup"
    log_info "4. Redeploy applications"
    log_info "5. Verify system functionality"
}

# Main execution
main() {
    check_prerequisites
    
    case "$ACTION" in
        backup)
            perform_backup
            ;;
        restore)
            log_error "Restore functionality requires specific backup file selection"
            log_info "Available backups:"
            find "$BACKUP_DIR" -name "*.sql*" -o -name "*.tar.gz" | head -10
            ;;
        test)
            test_backup_integrity
            ;;
        schedule)
            setup_backup_schedule
            ;;
        disaster-recovery)
            execute_disaster_recovery
            ;;
    esac
    
    log_success "Backup and disaster recovery operations completed!"
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"