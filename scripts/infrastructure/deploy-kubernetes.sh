#!/bin/bash

# Kubernetes Deployment Script for Fusion Bitcoin Bridge
# Deploys applications to Kubernetes using Kustomize

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
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

Deploy Fusion Bitcoin Bridge to Kubernetes using Kustomize.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (local, staging, production)
    -a, --action ACTION             Action to perform (apply, delete, diff, validate)
    -n, --namespace NAMESPACE       Kubernetes namespace (default: fusion-bitcoin)
    -c, --context CONTEXT           Kubectl context to use
    -f, --force                     Skip confirmation prompts
    -v, --verbose                   Enable verbose output
    -d, --dry-run                   Perform dry run (client-side only)
    -w, --wait                      Wait for rollout to complete
    -t, --timeout TIMEOUT           Timeout for rollout (default: 300s)
    -h, --help                      Show this help message

EXAMPLES:
    $0 -e local -a apply
    $0 -e production -a apply -w
    $0 -e staging -a delete -f
    $0 -e production -a diff

EOF
}

# Default values
ENVIRONMENT=""
ACTION="apply"
NAMESPACE="fusion-bitcoin"
CONTEXT=""
FORCE=false
VERBOSE=false
DRY_RUN=false
WAIT=false
TIMEOUT="300s"

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
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -c|--context)
            CONTEXT="$2"
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
            shift
            ;;
        -w|--wait)
            WAIT=true
            shift
            ;;
        -t|--timeout)
            TIMEOUT="$2"
            shift 2
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

if [[ ! "$ACTION" =~ ^(apply|delete|diff|validate|status)$ ]]; then
    log_error "Invalid action: $ACTION. Must be one of: apply, delete, diff, validate, status"
    exit 1
fi

# Enable verbose mode if requested
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

log_info "Starting Kubernetes deployment for Fusion Bitcoin Bridge"
log_info "Environment: $ENVIRONMENT"
log_info "Action: $ACTION"
log_info "Namespace: $NAMESPACE"

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if kubectl is installed
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed. Please install kubectl first."
        exit 1
    fi
    
    # Check if kustomize is installed
    if ! command -v kustomize &> /dev/null && ! kubectl kustomize --help &> /dev/null; then
        log_error "kustomize is not available. Please install kustomize or use kubectl >= 1.14."
        exit 1
    fi
    
    # Check kubectl connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster. Please check your kubectl configuration."
        exit 1
    fi
    
    # Set context if provided
    if [[ -n "$CONTEXT" ]]; then
        kubectl config use-context "$CONTEXT"
        log_info "Using kubectl context: $CONTEXT"
    fi
    
    log_success "Prerequisites check completed"
}

# Validate Kubernetes manifests
validate_manifests() {
    log_info "Validating Kubernetes manifests..."
    
    local kustomization_path="${K8S_DIR}/environments/${ENVIRONMENT}"
    
    if [[ ! -f "$kustomization_path/kustomization.yaml" ]]; then
        log_error "Kustomization file not found: $kustomization_path/kustomization.yaml"
        exit 1
    fi
    
    # Validate with kustomize
    cd "$kustomization_path"
    
    if command -v kustomize &> /dev/null; then
        kustomize build . | kubectl apply --dry-run=client -f -
    else
        kubectl kustomize . | kubectl apply --dry-run=client -f -
    fi
    
    log_success "Manifest validation completed"
}

# Apply Kubernetes resources
apply_resources() {
    log_info "Applying Kubernetes resources..."
    
    local kustomization_path="${K8S_DIR}/environments/${ENVIRONMENT}"
    
    # Create namespace if it doesn't exist
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_info "Creating namespace: $NAMESPACE"
        kubectl create namespace "$NAMESPACE"
    fi
    
    # Confirm before applying (unless force mode)
    if [[ "$FORCE" == "false" && "$DRY_RUN" == "false" ]]; then
        echo
        log_warning "You are about to apply resources for environment: $ENVIRONMENT"
        read -p "Do you want to continue? (yes/no): " -r
        if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            log_info "Operation cancelled"
            exit 0
        fi
    fi
    
    cd "$kustomization_path"
    
    local kubectl_args=""
    if [[ "$DRY_RUN" == "true" ]]; then
        kubectl_args="--dry-run=client"
    fi
    
    # Apply resources
    if command -v kustomize &> /dev/null; then
        kustomize build . | kubectl apply $kubectl_args -f -
    else
        kubectl apply $kubectl_args -k .
    fi
    
    if [[ "$DRY_RUN" == "false" ]]; then
        log_success "Resources applied successfully"
        
        # Wait for rollout if requested
        if [[ "$WAIT" == "true" ]]; then
            wait_for_rollout
        fi
        
        # Show status
        show_status
    else
        log_success "Dry run completed"
    fi
}

# Delete Kubernetes resources
delete_resources() {
    local kustomization_path="${K8S_DIR}/environments/${ENVIRONMENT}"
    
    log_warning "You are about to DELETE resources for environment: $ENVIRONMENT"
    
    if [[ "$ENVIRONMENT" == "production" ]]; then
        log_error "Production environment deletion requires additional confirmation"
        read -p "Type 'DELETE PRODUCTION' to confirm: " -r
        if [[ "$REPLY" != "DELETE PRODUCTION" ]]; then
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
    
    log_info "Deleting Kubernetes resources..."
    
    cd "$kustomization_path"
    
    # Delete resources
    if command -v kustomize &> /dev/null; then
        kustomize build . | kubectl delete -f - --ignore-not-found=true
    else
        kubectl delete -k . --ignore-not-found=true
    fi
    
    log_success "Resources deleted"
}

# Show diff
show_diff() {
    log_info "Showing resource diff..."
    
    local kustomization_path="${K8S_DIR}/environments/${ENVIRONMENT}"
    cd "$kustomization_path"
    
    # Generate current manifests
    if command -v kustomize &> /dev/null; then
        kustomize build . > "/tmp/fusion-bitcoin-${ENVIRONMENT}-new.yaml"
    else
        kubectl kustomize . > "/tmp/fusion-bitcoin-${ENVIRONMENT}-new.yaml"
    fi
    
    # Get currently applied resources
    kubectl get all,configmap,secret,pvc -n "$NAMESPACE" -o yaml > "/tmp/fusion-bitcoin-${ENVIRONMENT}-current.yaml" 2>/dev/null || echo "# No existing resources" > "/tmp/fusion-bitcoin-${ENVIRONMENT}-current.yaml"
    
    # Show diff
    if command -v diff &> /dev/null; then
        diff -u "/tmp/fusion-bitcoin-${ENVIRONMENT}-current.yaml" "/tmp/fusion-bitcoin-${ENVIRONMENT}-new.yaml" || true
    else
        log_info "diff command not available. Showing new manifests:"
        cat "/tmp/fusion-bitcoin-${ENVIRONMENT}-new.yaml"
    fi
    
    # Cleanup
    rm -f "/tmp/fusion-bitcoin-${ENVIRONMENT}-new.yaml" "/tmp/fusion-bitcoin-${ENVIRONMENT}-current.yaml"
}

# Wait for rollout completion
wait_for_rollout() {
    log_info "Waiting for rollout to complete..."
    
    local deployments=(
        "fusion-bitcoin-relayer"
        "fusion-bitcoin-resolver"
        "fusion-bitcoin-frontend"
    )
    
    for deployment in "${deployments[@]}"; do
        log_info "Waiting for deployment: $deployment"
        kubectl rollout status deployment/"$deployment" -n "$NAMESPACE" --timeout="$TIMEOUT" || {
            log_error "Rollout failed for deployment: $deployment"
            return 1
        }
    done
    
    log_success "All deployments rolled out successfully"
}

# Show resource status
show_status() {
    log_info "Resource status:"
    
    echo
    log_info "Pods:"
    kubectl get pods -n "$NAMESPACE" -o wide
    
    echo
    log_info "Services:"
    kubectl get services -n "$NAMESPACE"
    
    echo
    log_info "Ingress:"
    kubectl get ingress -n "$NAMESPACE" 2>/dev/null || log_info "No ingress resources found"
    
    echo
    log_info "ConfigMaps:"
    kubectl get configmaps -n "$NAMESPACE"
    
    echo
    log_info "Secrets:"
    kubectl get secrets -n "$NAMESPACE"
    
    echo
    log_info "PVCs:"
    kubectl get pvc -n "$NAMESPACE" 2>/dev/null || log_info "No PVC resources found"
    
    echo
    log_info "Events (last 10):"
    kubectl get events -n "$NAMESPACE" --sort-by='.lastTimestamp' | tail -10 || true
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."
    
    local failed_checks=0
    
    # Check if all pods are ready
    local pods=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}')
    
    for pod in $pods; do
        local ready=$(kubectl get pod "$pod" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
        if [[ "$ready" == "True" ]]; then
            log_success "Pod $pod is ready"
        else
            log_error "Pod $pod is not ready"
            ((failed_checks++))
        fi
    done
    
    # Check service endpoints
    local services=("fusion-bitcoin-relayer" "fusion-bitcoin-resolver" "fusion-bitcoin-frontend")
    
    for service in "${services[@]}"; do
        if kubectl get service "$service" -n "$NAMESPACE" &>/dev/null; then
            local endpoints=$(kubectl get endpoints "$service" -n "$NAMESPACE" -o jsonpath='{.subsets[*].addresses[*].ip}' | wc -w)
            if [[ $endpoints -gt 0 ]]; then
                log_success "Service $service has $endpoints endpoint(s)"
            else
                log_error "Service $service has no endpoints"
                ((failed_checks++))
            fi
        else
            log_warning "Service $service not found"
        fi
    done
    
    if [[ $failed_checks -eq 0 ]]; then
        log_success "All health checks passed"
    else
        log_error "$failed_checks health checks failed"
        exit 1
    fi
}

# Main execution
main() {
    check_prerequisites
    
    case "$ACTION" in
        validate)
            validate_manifests
            ;;
        apply)
            validate_manifests
            apply_resources
            ;;
        delete)
            delete_resources
            ;;
        diff)
            show_diff
            ;;
        status)
            show_status
            run_health_checks
            ;;
    esac
    
    log_success "Kubernetes deployment completed successfully!"
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"