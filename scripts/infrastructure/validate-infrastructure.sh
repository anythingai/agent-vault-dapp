#!/bin/bash

# Infrastructure Validation Script for Fusion Bitcoin Bridge
# Validates infrastructure configurations, security, compliance, and best practices

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TERRAFORM_DIR="${PROJECT_ROOT}/infrastructure/terraform"
K8S_DIR="${PROJECT_ROOT}/infrastructure/kubernetes"

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

Validate infrastructure configurations and deployments for Fusion Bitcoin Bridge.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (local, staging, production)
    -t, --type TYPE                  Validation type (all, terraform, kubernetes, security, network, compliance)
    -r, --region REGION             AWS region (default: us-west-2)
    -f, --format FORMAT             Output format (text, json, junit)
    -o, --output FILE               Output file (default: stdout)
    -v, --verbose                   Enable verbose output
    -s, --strict                    Enable strict mode (fail on warnings)
    -x, --fix                       Auto-fix issues where possible
    -c, --config-only               Validate configurations only (skip live resources)
    -h, --help                      Show this help message

VALIDATION TYPES:
    all             Run all validation checks (default)
    terraform       Validate Terraform configurations
    kubernetes      Validate Kubernetes manifests
    security        Security configuration validation
    network         Network configuration validation
    compliance      Compliance and best practices validation

EXAMPLES:
    $0 -e staging -t all
    $0 -e production -t security -s
    $0 -e local -t terraform -x
    $0 -e production -f junit -o validation-report.xml

EOF
}

# Default values
ENVIRONMENT=""
VALIDATION_TYPE="all"
AWS_REGION="us-west-2"
OUTPUT_FORMAT="text"
OUTPUT_FILE=""
VERBOSE=false
STRICT_MODE=false
AUTO_FIX=false
CONFIG_ONLY=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -t|--type)
            VALIDATION_TYPE="$2"
            shift 2
            ;;
        -r|--region)
            AWS_REGION="$2"
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
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -s|--strict)
            STRICT_MODE=true
            shift
            ;;
        -x|--fix)
            AUTO_FIX=true
            shift
            ;;
        -c|--config-only)
            CONFIG_ONLY=true
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

if [[ ! "$VALIDATION_TYPE" =~ ^(all|terraform|kubernetes|security|network|compliance)$ ]]; then
    log_error "Invalid validation type: $VALIDATION_TYPE. Must be one of: all, terraform, kubernetes, security, network, compliance"
    exit 1
fi

# Enable verbose mode if requested
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

# Global validation tracking
TOTAL_CHECKS=0
PASSED_CHECKS=0
WARNING_CHECKS=0
FAILED_CHECKS=0
declare -a VALIDATION_RESULTS

# Record validation result
record_validation() {
    local component=$1
    local status=$2
    local message=$3
    local severity=${4:-"info"}
    
    VALIDATION_RESULTS+=("$component|$status|$message|$severity")
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    
    case $status in
        "PASS")
            PASSED_CHECKS=$((PASSED_CHECKS + 1))
            log_success "$component: $message"
            ;;
        "WARN")
            WARNING_CHECKS=$((WARNING_CHECKS + 1))
            log_warning "$component: $message"
            if [[ "$STRICT_MODE" == "true" ]]; then
                FAILED_CHECKS=$((FAILED_CHECKS + 1))
                PASSED_CHECKS=$((PASSED_CHECKS - 1))
            fi
            ;;
        "FAIL")
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            log_error "$component: $message"
            ;;
    esac
}

log_info "Starting infrastructure validation for Fusion Bitcoin Bridge"
log_info "Environment: $ENVIRONMENT"
log_info "Validation Type: $VALIDATION_TYPE"
log_info "Strict Mode: $STRICT_MODE"

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if required tools are installed
    local required_tools=("terraform" "kubectl" "aws")
    local optional_tools=("jq" "yq" "helm" "tfsec" "checkov")
    
    for tool in "${required_tools[@]}"; do
        if command -v "$tool" &> /dev/null; then
            record_validation "PREREQ_${tool^^}" "PASS" "$tool is available"
        else
            record_validation "PREREQ_${tool^^}" "FAIL" "$tool is not installed"
        fi
    done
    
    for tool in "${optional_tools[@]}"; do
        if command -v "$tool" &> /dev/null; then
            record_validation "PREREQ_${tool^^}" "PASS" "$tool is available"
        else
            record_validation "PREREQ_${tool^^}" "WARN" "$tool is not installed (optional)"
        fi
    done
    
    # Check AWS credentials
    if command -v aws &> /dev/null && [[ "$CONFIG_ONLY" == "false" ]]; then
        if aws sts get-caller-identity &> /dev/null; then
            record_validation "AWS_CREDS" "PASS" "AWS credentials are configured"
        else
            record_validation "AWS_CREDS" "FAIL" "AWS credentials not configured"
        fi
    fi
    
    # Check kubectl connectivity (for live validation)
    if command -v kubectl &> /dev/null && [[ "$CONFIG_ONLY" == "false" ]]; then
        if kubectl cluster-info &> /dev/null; then
            record_validation "K8S_CONNECTIVITY" "PASS" "Kubernetes cluster is accessible"
        else
            record_validation "K8S_CONNECTIVITY" "WARN" "Kubernetes cluster not accessible (expected for config-only validation)"
        fi
    fi
}

# Validate Terraform configurations
validate_terraform() {
    log_info "Validating Terraform configurations..."
    
    if [[ ! -d "$TERRAFORM_DIR" ]]; then
        record_validation "TF_DIR" "FAIL" "Terraform directory not found: $TERRAFORM_DIR"
        return
    fi
    
    cd "$TERRAFORM_DIR"
    
    # Check for required Terraform files
    local required_files=("main.tf" "variables.tf" "outputs.tf")
    for file in "${required_files[@]}"; do
        if [[ -f "$file" ]]; then
            record_validation "TF_FILE_$file" "PASS" "Required file exists: $file"
        else
            record_validation "TF_FILE_$file" "FAIL" "Required file missing: $file"
        fi
    done
    
    # Check environment-specific tfvars
    local tfvars_file="environments/${ENVIRONMENT}.tfvars"
    if [[ -f "$tfvars_file" ]]; then
        record_validation "TF_TFVARS" "PASS" "Environment tfvars file exists: $tfvars_file"
    else
        record_validation "TF_TFVARS" "FAIL" "Environment tfvars file missing: $tfvars_file"
    fi
    
    # Validate Terraform syntax
    if command -v terraform &> /dev/null; then
        if terraform validate &> /dev/null; then
            record_validation "TF_SYNTAX" "PASS" "Terraform syntax is valid"
        else
            record_validation "TF_SYNTAX" "FAIL" "Terraform syntax validation failed"
        fi
        
        # Check formatting
        if terraform fmt -check -recursive &> /dev/null; then
            record_validation "TF_FORMAT" "PASS" "Terraform files are properly formatted"
        else
            record_validation "TF_FORMAT" "WARN" "Terraform files need formatting"
            if [[ "$AUTO_FIX" == "true" ]]; then
                terraform fmt -recursive
                log_info "Auto-fixed Terraform formatting"
            fi
        fi
        
        # Initialize and validate with tfvars
        if [[ -f "$tfvars_file" ]]; then
            if terraform init -upgrade &> /dev/null; then
                record_validation "TF_INIT" "PASS" "Terraform initialization successful"
                
                # Validate with environment variables
                if terraform validate &> /dev/null; then
                    record_validation "TF_VALIDATE_ENV" "PASS" "Terraform validation with $ENVIRONMENT vars successful"
                else
                    record_validation "TF_VALIDATE_ENV" "FAIL" "Terraform validation with $ENVIRONMENT vars failed"
                fi
            else
                record_validation "TF_INIT" "FAIL" "Terraform initialization failed"
            fi
        fi
    fi
    
    # Security scanning with tfsec (if available)
    if command -v tfsec &> /dev/null; then
        local tfsec_output="/tmp/tfsec-results.json"
        if tfsec --format json --out "$tfsec_output" . &> /dev/null; then
            local critical_issues=$(jq '[.results[] | select(.severity == "CRITICAL")] | length' "$tfsec_output" 2>/dev/null || echo "0")
            local high_issues=$(jq '[.results[] | select(.severity == "HIGH")] | length' "$tfsec_output" 2>/dev/null || echo "0")
            
            if [[ "$critical_issues" -eq 0 && "$high_issues" -eq 0 ]]; then
                record_validation "TF_SECURITY" "PASS" "No critical or high security issues found"
            elif [[ "$critical_issues" -gt 0 ]]; then
                record_validation "TF_SECURITY" "FAIL" "$critical_issues critical security issues found"
            else
                record_validation "TF_SECURITY" "WARN" "$high_issues high security issues found"
            fi
        else
            record_validation "TF_SECURITY" "WARN" "Security scan failed to complete"
        fi
        rm -f "$tfsec_output"
    fi
}

# Validate Kubernetes manifests
validate_kubernetes() {
    log_info "Validating Kubernetes configurations..."
    
    if [[ ! -d "$K8S_DIR" ]]; then
        record_validation "K8S_DIR" "FAIL" "Kubernetes directory not found: $K8S_DIR"
        return
    fi
    
    # Check directory structure
    local required_dirs=("base" "environments/$ENVIRONMENT")
    for dir in "${required_dirs[@]}"; do
        if [[ -d "$K8S_DIR/$dir" ]]; then
            record_validation "K8S_DIR_$dir" "PASS" "Required directory exists: $dir"
        else
            record_validation "K8S_DIR_$dir" "FAIL" "Required directory missing: $dir"
        fi
    done
    
    # Check for kustomization files
    local kustomization_files=("$K8S_DIR/base/kustomization.yaml" "$K8S_DIR/environments/$ENVIRONMENT/kustomization.yaml")
    for file in "${kustomization_files[@]}"; do
        if [[ -f "$file" ]]; then
            record_validation "K8S_KUSTOMIZE_$(basename $(dirname $file))" "PASS" "Kustomization file exists: $file"
        else
            record_validation "K8S_KUSTOMIZE_$(basename $(dirname $file))" "FAIL" "Kustomization file missing: $file"
        fi
    done
    
    # Validate YAML syntax
    find "$K8S_DIR" -name "*.yaml" -o -name "*.yml" | while read -r yaml_file; do
        if command -v yq &> /dev/null; then
            if yq eval '.' "$yaml_file" &> /dev/null; then
                record_validation "K8S_YAML_$(basename $yaml_file)" "PASS" "YAML syntax valid: $(basename $yaml_file)"
            else
                record_validation "K8S_YAML_$(basename $yaml_file)" "FAIL" "YAML syntax invalid: $(basename $yaml_file)"
            fi
        elif command -v kubectl &> /dev/null; then
            if kubectl apply --dry-run=client -f "$yaml_file" &> /dev/null; then
                record_validation "K8S_YAML_$(basename $yaml_file)" "PASS" "YAML syntax valid: $(basename $yaml_file)"
            else
                record_validation "K8S_YAML_$(basename $yaml_file)" "FAIL" "YAML syntax invalid: $(basename $yaml_file)"
            fi
        fi
    done
    
    # Validate Kustomize build
    local kustomization_path="$K8S_DIR/environments/$ENVIRONMENT"
    if [[ -f "$kustomization_path/kustomization.yaml" ]]; then
        cd "$kustomization_path"
        
        if command -v kustomize &> /dev/null; then
            if kustomize build . > /dev/null; then
                record_validation "K8S_KUSTOMIZE_BUILD" "PASS" "Kustomize build successful for $ENVIRONMENT"
            else
                record_validation "K8S_KUSTOMIZE_BUILD" "FAIL" "Kustomize build failed for $ENVIRONMENT"
            fi
        elif command -v kubectl &> /dev/null; then
            if kubectl kustomize . > /dev/null; then
                record_validation "K8S_KUSTOMIZE_BUILD" "PASS" "Kustomize build successful for $ENVIRONMENT"
            else
                record_validation "K8S_KUSTOMIZE_BUILD" "FAIL" "Kustomize build failed for $ENVIRONMENT"
            fi
        fi
        
        # Validate against Kubernetes API
        if command -v kubectl &> /dev/null && kubectl cluster-info &> /dev/null; then
            if command -v kustomize &> /dev/null; then
                if kustomize build . | kubectl apply --dry-run=server -f - &> /dev/null; then
                    record_validation "K8S_SERVER_VALIDATE" "PASS" "Server-side validation successful"
                else
                    record_validation "K8S_SERVER_VALIDATE" "FAIL" "Server-side validation failed"
                fi
            fi
        fi
    fi
    
    # Check resource requirements and limits
    find "$K8S_DIR" -name "*.yaml" -exec grep -l "resources:" {} \; | while read -r file; do
        if grep -q "requests:" "$file" && grep -q "limits:" "$file"; then
            record_validation "K8S_RESOURCES_$(basename $file)" "PASS" "Resource requests and limits defined: $(basename $file)"
        else
            record_validation "K8S_RESOURCES_$(basename $file)" "WARN" "Missing resource requests or limits: $(basename $file)"
        fi
    done
}

# Validate security configurations
validate_security() {
    log_info "Validating security configurations..."
    
    # Check RBAC configurations
    if [[ -f "$K8S_DIR/base/rbac.yaml" ]]; then
        record_validation "SECURITY_RBAC" "PASS" "RBAC configuration exists"
        
        # Check for least privilege principles
        if grep -q "rules:" "$K8S_DIR/base/rbac.yaml"; then
            record_validation "SECURITY_RBAC_RULES" "PASS" "RBAC rules defined"
        else
            record_validation "SECURITY_RBAC_RULES" "WARN" "RBAC rules not found"
        fi
    else
        record_validation "SECURITY_RBAC" "FAIL" "RBAC configuration missing"
    fi
    
    # Check for network policies
    if find "$K8S_DIR" -name "*.yaml" -exec grep -l "NetworkPolicy" {} \; | grep -q .; then
        record_validation "SECURITY_NETWORK_POLICY" "PASS" "Network policies configured"
    else
        record_validation "SECURITY_NETWORK_POLICY" "WARN" "Network policies not configured"
    fi
    
    # Check for security contexts
    if find "$K8S_DIR" -name "*.yaml" -exec grep -l "securityContext:" {} \; | grep -q .; then
        record_validation "SECURITY_CONTEXT" "PASS" "Security contexts configured"
    else
        record_validation "SECURITY_CONTEXT" "WARN" "Security contexts not configured"
    fi
    
    # Check for secrets management
    if find "$K8S_DIR" -name "*.yaml" -exec grep -l "Secret" {} \; | grep -q .; then
        record_validation "SECURITY_SECRETS" "PASS" "Kubernetes secrets configured"
        
        # Warn about hardcoded secrets (basic check)
        if find "$K8S_DIR" -name "*.yaml" -exec grep -l "password:" {} \; | grep -q .; then
            record_validation "SECURITY_HARDCODED" "FAIL" "Potential hardcoded credentials found"
        else
            record_validation "SECURITY_HARDCODED" "PASS" "No obvious hardcoded credentials found"
        fi
    else
        record_validation "SECURITY_SECRETS" "WARN" "No Kubernetes secrets configured"
    fi
    
    # Check Terraform security configurations
    if [[ -f "$TERRAFORM_DIR/security.tf" ]]; then
        record_validation "SECURITY_TF_MODULE" "PASS" "Terraform security module exists"
        
        # Check for encryption at rest
        if grep -q "encrypt" "$TERRAFORM_DIR/security.tf"; then
            record_validation "SECURITY_ENCRYPTION" "PASS" "Encryption configurations found"
        else
            record_validation "SECURITY_ENCRYPTION" "WARN" "Encryption configurations not found"
        fi
        
        # Check for WAF configuration
        if grep -q -i "waf" "$TERRAFORM_DIR"/*.tf; then
            record_validation "SECURITY_WAF" "PASS" "WAF configuration found"
        else
            record_validation "SECURITY_WAF" "WARN" "WAF configuration not found"
        fi
    else
        record_validation "SECURITY_TF_MODULE" "WARN" "Terraform security module not found"
    fi
}

# Validate network configurations
validate_network() {
    log_info "Validating network configurations..."
    
    # Check VPC configuration
    if [[ -f "$TERRAFORM_DIR/vpc.tf" ]]; then
        record_validation "NETWORK_VPC" "PASS" "VPC configuration exists"
        
        # Check for multi-AZ setup
        if grep -q -E "(availability_zone|subnet.*a|subnet.*b)" "$TERRAFORM_DIR/vpc.tf"; then
            record_validation "NETWORK_MULTI_AZ" "PASS" "Multi-AZ configuration detected"
        else
            record_validation "NETWORK_MULTI_AZ" "WARN" "Multi-AZ configuration not detected"
        fi
        
        # Check for private/public subnets
        if grep -q "private" "$TERRAFORM_DIR/vpc.tf" && grep -q "public" "$TERRAFORM_DIR/vpc.tf"; then
            record_validation "NETWORK_SUBNETS" "PASS" "Both private and public subnets configured"
        else
            record_validation "NETWORK_SUBNETS" "WARN" "Private/public subnet configuration incomplete"
        fi
    else
        record_validation "NETWORK_VPC" "FAIL" "VPC configuration not found"
    fi
    
    # Check load balancer configuration
    if [[ -f "$TERRAFORM_DIR/alb.tf" ]]; then
        record_validation "NETWORK_ALB" "PASS" "Load balancer configuration exists"
    else
        record_validation "NETWORK_ALB" "WARN" "Load balancer configuration not found"
    fi
    
    # Check for proper ingress configurations in Kubernetes
    if find "$K8S_DIR" -name "*.yaml" -exec grep -l "Ingress" {} \; | grep -q .; then
        record_validation "NETWORK_K8S_INGRESS" "PASS" "Kubernetes ingress configured"
    else
        record_validation "NETWORK_K8S_INGRESS" "WARN" "Kubernetes ingress not configured"
    fi
    
    # Check service mesh configuration (if applicable)
    if find "$K8S_DIR" -name "*.yaml" -exec grep -l "istio\|linkerd" {} \; | grep -q .; then
        record_validation "NETWORK_SERVICE_MESH" "PASS" "Service mesh configuration detected"
    else
        record_validation "NETWORK_SERVICE_MESH" "WARN" "Service mesh not configured (optional)"
    fi
}

# Validate compliance and best practices
validate_compliance() {
    log_info "Validating compliance and best practices..."
    
    # Check for resource tagging
    if grep -q "tags" "$TERRAFORM_DIR"/*.tf; then
        record_validation "COMPLIANCE_TAGGING" "PASS" "Resource tagging implemented"
    else
        record_validation "COMPLIANCE_TAGGING" "WARN" "Resource tagging not consistently implemented"
    fi
    
    # Check for monitoring configuration
    if [[ -f "$TERRAFORM_DIR/monitoring.tf" ]] || [[ -f "$K8S_DIR/base/monitoring.yaml" ]]; then
        record_validation "COMPLIANCE_MONITORING" "PASS" "Monitoring configuration exists"
    else
        record_validation "COMPLIANCE_MONITORING" "WARN" "Monitoring configuration missing"
    fi
    
    # Check for backup configurations
    if grep -q -i "backup\|snapshot" "$TERRAFORM_DIR"/*.tf; then
        record_validation "COMPLIANCE_BACKUP" "PASS" "Backup configuration found"
    else
        record_validation "COMPLIANCE_BACKUP" "WARN" "Backup configuration not found"
    fi
    
    # Check for high availability configurations
    local ha_indicators=("replica" "cluster" "multi-az" "availability_zone")
    local ha_found=false
    
    for indicator in "${ha_indicators[@]}"; do
        if grep -q -i "$indicator" "$TERRAFORM_DIR"/*.tf "$K8S_DIR"/**/*.yaml 2>/dev/null; then
            ha_found=true
            break
        fi
    done
    
    if [[ "$ha_found" == "true" ]]; then
        record_validation "COMPLIANCE_HA" "PASS" "High availability configurations detected"
    else
        record_validation "COMPLIANCE_HA" "WARN" "High availability configurations not detected"
    fi
    
    # Check for disaster recovery plans
    if [[ -f "${PROJECT_ROOT}/docs/disaster-recovery.md" ]] || grep -q -i "disaster\|recovery" "$TERRAFORM_DIR"/*.tf; then
        record_validation "COMPLIANCE_DR" "PASS" "Disaster recovery considerations found"
    else
        record_validation "COMPLIANCE_DR" "WARN" "Disaster recovery plans not documented"
    fi
    
    # Check for environment separation
    if [[ -d "$TERRAFORM_DIR/environments" ]] && [[ -d "$K8S_DIR/environments" ]]; then
        record_validation "COMPLIANCE_ENV_SEPARATION" "PASS" "Environment separation implemented"
    else
        record_validation "COMPLIANCE_ENV_SEPARATION" "WARN" "Environment separation not properly implemented"
    fi
    
    # Check for version pinning
    if grep -q "version.*=" "$TERRAFORM_DIR"/*.tf; then
        record_validation "COMPLIANCE_VERSION_PINNING" "PASS" "Version pinning detected in Terraform"
    else
        record_validation "COMPLIANCE_VERSION_PINNING" "WARN" "Version pinning not detected in Terraform"
    fi
    
    # Check for proper resource naming conventions
    local naming_convention=true
    if ! grep -q "fusion-bitcoin" "$TERRAFORM_DIR"/*.tf; then
        naming_convention=false
    fi
    
    if [[ "$naming_convention" == "true" ]]; then
        record_validation "COMPLIANCE_NAMING" "PASS" "Naming conventions followed"
    else
        record_validation "COMPLIANCE_NAMING" "WARN" "Naming conventions not consistently followed"
    fi
}

# Generate validation report
generate_validation_report() {
    log_info "Generating validation report..."
    
    local report_file
    if [[ -n "$OUTPUT_FILE" ]]; then
        report_file="$OUTPUT_FILE"
    else
        report_file="${PROJECT_ROOT}/validation-report-${ENVIRONMENT}-$(date +%Y%m%d_%H%M%S).${OUTPUT_FORMAT}"
    fi
    
    case "$OUTPUT_FORMAT" in
        json)
            generate_json_validation_report "$report_file"
            ;;
        junit)
            generate_junit_validation_report "$report_file"
            ;;
        *)
            generate_text_validation_report "$report_file"
            ;;
    esac
    
    log_success "Validation report saved to: $report_file"
}

# Generate text validation report
generate_text_validation_report() {
    local report_file="$1"
    
    cat > "$report_file" << EOF
# Infrastructure Validation Report - Fusion Bitcoin Bridge
Environment: $ENVIRONMENT
Generated: $(date)
Validation Type: $VALIDATION_TYPE
Strict Mode: $STRICT_MODE

## Summary
- Total Checks: $TOTAL_CHECKS
- Passed: $PASSED_CHECKS
- Warnings: $WARNING_CHECKS
- Failed: $FAILED_CHECKS

## Validation Results

EOF

    for result in "${VALIDATION_RESULTS[@]}"; do
        IFS='|' read -r component status message severity <<< "$result"
        echo "### $component" >> "$report_file"
        echo "Status: $status" >> "$report_file"
        echo "Message: $message" >> "$report_file"
        echo "Severity: $severity" >> "$report_file"
        echo "" >> "$report_file"
    done
}

# Generate JSON validation report
generate_json_validation_report() {
    local report_file="$1"
    
    cat > "$report_file" << EOF
{
    "validation_report": {
        "environment": "$ENVIRONMENT",
        "generated_at": "$(date --iso-8601)",
        "validation_type": "$VALIDATION_TYPE",
        "strict_mode": $STRICT_MODE
    },
    "summary": {
        "total_checks": $TOTAL_CHECKS,
        "passed": $PASSED_CHECKS,
        "warnings": $WARNING_CHECKS,
        "failed": $FAILED_CHECKS
    },
    "results": [
EOF

    local first=true
    for result in "${VALIDATION_RESULTS[@]}"; do
        IFS='|' read -r component status message severity <<< "$result"
        if [[ "$first" == "true" ]]; then
            first=false
        else
            echo "," >> "$report_file"
        fi
        cat >> "$report_file" << EOF
        {
            "component": "$component",
            "status": "$status",
            "message": "$message",
            "severity": "$severity"
        }
EOF
    done

    cat >> "$report_file" << EOF
    ]
}
EOF
}

# Generate JUnit XML validation report
generate_junit_validation_report() {
    local report_file="$1"
    
    cat > "$report_file" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Infrastructure Validation" tests="$TOTAL_CHECKS" failures="$FAILED_CHECKS" errors="0" time="$(date +%s)">
EOF

    for result in "${VALIDATION_RESULTS[@]}"; do
        IFS='|' read -r component status message severity <<< "$result"
        echo "    <testcase classname=\"$VALIDATION_TYPE\" name=\"$component\">" >> "$report_file"
        
        if [[ "$status" == "FAIL" ]]; then
            echo "        <failure message=\"$message\">$message</failure>" >> "$report_file"
        elif [[ "$status" == "WARN" && "$STRICT_MODE" == "true" ]]; then
            echo "        <failure message=\"$message\">$message</failure>" >> "$report_file"
        fi
        
        echo "    </testcase>" >> "$report_file"
    done

    echo "</testsuite>" >> "$report_file"
}

# Main execution
main() {
    check_prerequisites
    
    case "$VALIDATION_TYPE" in
        terraform)
            validate_terraform
            ;;
        kubernetes)
            validate_kubernetes
            ;;
        security)
            validate_security
            ;;
        network)
            validate_network
            ;;
        compliance)
            validate_compliance
            ;;
        all)
            validate_terraform
            validate_kubernetes
            validate_security
            validate_network
            validate_compliance
            ;;
    esac
    
    echo
    log_info "Validation Summary:"
    log_info "Total Checks: $TOTAL_CHECKS"
    log_success "Passed: $PASSED_CHECKS"
    if [[ "$WARNING_CHECKS" -gt 0 ]]; then
        log_warning "Warnings: $WARNING_CHECKS"
    fi
    if [[ "$FAILED_CHECKS" -gt 0 ]]; then
        log_error "Failed: $FAILED_CHECKS"
    fi
    
    # Generate report if requested
    if [[ -n "$OUTPUT_FILE" || "$OUTPUT_FORMAT" != "text" ]]; then
        generate_validation_report
    fi
    
    # Exit with appropriate code
    if [[ "$FAILED_CHECKS" -gt 0 ]]; then
        log_error "Validation failed with $FAILED_CHECKS failed checks"
        exit 1
    elif [[ "$WARNING_CHECKS" -gt 0 && "$STRICT_MODE" == "true" ]]; then
        log_error "Validation failed in strict mode with $WARNING_CHECKS warnings"
        exit 1
    else
        log_success "Infrastructure validation completed successfully!"
        exit 0
    fi
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"