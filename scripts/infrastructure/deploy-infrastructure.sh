#!/bin/bash

# Infrastructure Deployment Script for Fusion Bitcoin Bridge
# Deploys infrastructure using Terraform across different environments

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

Deploy infrastructure for Fusion Bitcoin Bridge using Terraform.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (local, staging, production)
    -a, --action ACTION             Action to perform (plan, apply, destroy, validate)
    -r, --region REGION             AWS region (default: us-west-2)
    -f, --force                     Skip confirmation prompts
    -v, --verbose                   Enable verbose output
    -d, --dry-run                   Perform dry run (plan only)
    -h, --help                      Show this help message

EXAMPLES:
    $0 -e staging -a plan
    $0 -e production -a apply
    $0 -e staging -a destroy -f

EOF
}

# Default values
ENVIRONMENT=""
ACTION="plan"
AWS_REGION="us-west-2"
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
        -r|--region)
            AWS_REGION="$2"
            shift 2
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -d|--dry-run)
            DRY_RUN=true
            ACTION="plan"
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

if [[ ! "$ACTION" =~ ^(plan|apply|destroy|validate|init|output)$ ]]; then
    log_error "Invalid action: $ACTION. Must be one of: plan, apply, destroy, validate, init, output"
    exit 1
fi

# Enable verbose mode if requested
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

log_info "Starting infrastructure deployment for Fusion Bitcoin Bridge"
log_info "Environment: $ENVIRONMENT"
log_info "Action: $ACTION"
log_info "Region: $AWS_REGION"

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Terraform is installed
    if ! command -v terraform &> /dev/null; then
        log_error "Terraform is not installed. Please install Terraform first."
        exit 1
    fi
    
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
    
    # Check if kubectl is installed (for EKS operations)
    if ! command -v kubectl &> /dev/null; then
        log_warning "kubectl is not installed. Required for EKS cluster operations."
    fi
    
    log_success "Prerequisites check completed"
}

# Initialize Terraform backend
init_terraform() {
    log_info "Initializing Terraform..."
    
    cd "$TERRAFORM_DIR"
    
    # Configure backend for specific environment
    cat > backend.tf << EOF
terraform {
  backend "s3" {
    bucket         = "fusion-bitcoin-terraform-state-${ENVIRONMENT}"
    key            = "infrastructure/terraform.tfstate"
    region         = "${AWS_REGION}"
    encrypt        = true
    dynamodb_table = "fusion-bitcoin-terraform-locks-${ENVIRONMENT}"
  }
}
EOF
    
    # Initialize Terraform
    terraform init -upgrade
    
    log_success "Terraform initialized successfully"
}

# Validate Terraform configuration
validate_terraform() {
    log_info "Validating Terraform configuration..."
    
    cd "$TERRAFORM_DIR"
    
    # Validate configuration
    terraform validate
    
    # Check formatting
    if ! terraform fmt -check; then
        log_warning "Terraform files are not properly formatted. Running terraform fmt..."
        terraform fmt -recursive
    fi
    
    log_success "Terraform configuration is valid"
}

# Plan infrastructure changes
plan_infrastructure() {
    log_info "Planning infrastructure changes..."
    
    cd "$TERRAFORM_DIR"
    
    local tfvars_file="environments/${ENVIRONMENT}.tfvars"
    
    if [[ ! -f "$tfvars_file" ]]; then
        log_error "Environment file not found: $tfvars_file"
        exit 1
    fi
    
    # Generate plan
    terraform plan \
        -var-file="$tfvars_file" \
        -var="aws_region=$AWS_REGION" \
        -out="tfplan-${ENVIRONMENT}" \
        -detailed-exitcode
    
    local exit_code=$?
    
    case $exit_code in
        0)
            log_info "No changes detected in infrastructure"
            ;;
        1)
            log_error "Terraform plan failed"
            exit 1
            ;;
        2)
            log_info "Infrastructure changes detected"
            ;;
    esac
    
    log_success "Infrastructure plan completed"
    return $exit_code
}

# Apply infrastructure changes
apply_infrastructure() {
    log_info "Applying infrastructure changes..."
    
    cd "$TERRAFORM_DIR"
    
    # Check if plan exists
    if [[ ! -f "tfplan-${ENVIRONMENT}" ]]; then
        log_warning "No plan found. Generating plan first..."
        plan_infrastructure
    fi
    
    # Confirm before applying (unless force mode)
    if [[ "$FORCE" == "false" ]]; then
        echo
        log_warning "You are about to apply infrastructure changes for environment: $ENVIRONMENT"
        read -p "Do you want to continue? (yes/no): " -r
        if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            log_info "Operation cancelled"
            exit 0
        fi
    fi
    
    # Apply changes
    terraform apply "tfplan-${ENVIRONMENT}"
    
    log_success "Infrastructure applied successfully"
    
    # Update kubectl configuration for EKS
    if command -v kubectl &> /dev/null; then
        log_info "Updating kubectl configuration..."
        local cluster_name=$(terraform output -raw eks_cluster_name 2>/dev/null || echo "")
        if [[ -n "$cluster_name" ]]; then
            aws eks update-kubeconfig --region "$AWS_REGION" --name "$cluster_name"
            log_success "kubectl configuration updated"
        fi
    fi
}

# Destroy infrastructure
destroy_infrastructure() {
    log_error "WARNING: You are about to DESTROY infrastructure for environment: $ENVIRONMENT"
    log_error "This action is IRREVERSIBLE and will delete all resources!"
    
    if [[ "$ENVIRONMENT" == "production" ]]; then
        log_error "Production environment destruction requires additional confirmation"
        read -p "Type 'DESTROY PRODUCTION' to confirm: " -r
        if [[ "$REPLY" != "DESTROY PRODUCTION" ]]; then
            log_info "Operation cancelled"
            exit 0
        fi
    fi
    
    if [[ "$FORCE" == "false" ]]; then
        read -p "Are you absolutely sure? (yes/no): " -r
        if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            log_info "Operation cancelled"
            exit 0
        fi
    fi
    
    cd "$TERRAFORM_DIR"
    
    local tfvars_file="environments/${ENVIRONMENT}.tfvars"
    
    terraform destroy \
        -var-file="$tfvars_file" \
        -var="aws_region=$AWS_REGION" \
        -auto-approve
    
    log_success "Infrastructure destroyed"
}

# Get infrastructure outputs
get_outputs() {
    log_info "Getting infrastructure outputs..."
    
    cd "$TERRAFORM_DIR"
    
    terraform output -json > "outputs-${ENVIRONMENT}.json"
    
    echo
    log_info "Key outputs:"
    terraform output vpc_id
    terraform output eks_cluster_endpoint
    terraform output load_balancer_dns
    
    log_success "Outputs saved to outputs-${ENVIRONMENT}.json"
}

# Main execution flow
main() {
    check_prerequisites
    
    case "$ACTION" in
        init)
            init_terraform
            ;;
        validate)
            validate_terraform
            ;;
        plan)
            init_terraform
            validate_terraform
            plan_infrastructure
            ;;
        apply)
            init_terraform
            validate_terraform
            plan_infrastructure
            if [[ "$DRY_RUN" == "false" ]]; then
                apply_infrastructure
            else
                log_info "Dry run completed. Use without -d flag to apply changes."
            fi
            ;;
        destroy)
            init_terraform
            destroy_infrastructure
            ;;
        output)
            get_outputs
            ;;
    esac
    
    log_success "Infrastructure deployment completed successfully!"
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"