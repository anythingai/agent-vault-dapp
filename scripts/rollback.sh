#!/bin/bash

# Production Rollback Script for 1inch Fusion Bitcoin Bridge
# This script handles emergency rollback procedures

set -e  # Exit on any error
set -o pipefail  # Exit on pipe failures

# Configuration
NAMESPACE="fusion-bitcoin"
ENVIRONMENT="production"

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

log_step() {
    echo -e "\n${BLUE}==============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}==============================================================================${NC}"
}

# Error handling
error_exit() {
    log_error "$1"
    exit 1
}

# Display usage information
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help           Show this help message"
    echo "  -v, --version        Rollback to specific version"
    echo "  -r, --revision       Rollback to specific revision (default: previous)"
    echo "  -s, --service        Rollback specific service only (relayer|resolver|frontend|all)"
    echo "  -d, --dry-run        Show what would be done without executing"
    echo "  --skip-health-check  Skip post-rollback health checks"
    echo "  --emergency          Emergency rollback (skip confirmations)"
    echo ""
    echo "Examples:"
    echo "  $0                           # Rollback all services to previous revision"
    echo "  $0 --service relayer         # Rollback only relayer service"
    echo "  $0 --version 1.0.0           # Rollback to specific version"
    echo "  $0 --emergency               # Emergency rollback (no confirmations)"
    echo "  $0 --dry-run                 # Show rollback plan without executing"
}

# Parse command line arguments
parse_arguments() {
    ROLLBACK_VERSION=""
    ROLLBACK_REVISION="previous"
    SERVICE="all"
    DRY_RUN=false
    SKIP_HEALTH_CHECK=false
    EMERGENCY=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                usage
                exit 0
                ;;
            -v|--version)
                ROLLBACK_VERSION="$2"
                shift 2
                ;;
            -r|--revision)
                ROLLBACK_REVISION="$2"
                shift 2
                ;;
            -s|--service)
                SERVICE="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-health-check)
                SKIP_HEALTH_CHECK=true
                shift
                ;;
            --emergency)
                EMERGENCY=true
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # Validate service parameter
    if [[ "$SERVICE" != "all" && "$SERVICE" != "relayer" && "$SERVICE" != "resolver" && "$SERVICE" != "frontend" ]]; then
        error_exit "Invalid service: $SERVICE. Must be one of: all, relayer, resolver, frontend"
    fi
}

# Get current deployment status
get_deployment_status() {
    log_step "📊 Getting Current Deployment Status"
    
    echo -e "${BLUE}Current deployment status:${NC}"
    kubectl get deployments -n $NAMESPACE -l app=fusion-bitcoin-bridge -o wide
    echo ""
    
    echo -e "${BLUE}Recent rollout history:${NC}"
    if [[ "$SERVICE" == "all" ]]; then
        for svc in relayer resolver frontend; do
            echo -e "\n${YELLOW}fusion-bitcoin-${svc}:${NC}"
            kubectl rollout history deployment/fusion-bitcoin-${svc} -n $NAMESPACE --revision=$ROLLBACK_REVISION || log_warning "No history available for $svc"
        done
    else
        kubectl rollout history deployment/fusion-bitcoin-${SERVICE} -n $NAMESPACE --revision=$ROLLBACK_REVISION || log_warning "No history available for $SERVICE"
    fi
}

# Check rollback prerequisites
check_prerequisites() {
    log_step "🔍 Checking Rollback Prerequisites"
    
    # Check if kubectl is configured
    kubectl cluster-info >/dev/null 2>&1 || error_exit "kubectl is not configured or cluster is not accessible"
    
    # Check if namespace exists
    kubectl get namespace $NAMESPACE >/dev/null 2>&1 || error_exit "Namespace $NAMESPACE does not exist"
    
    # Check if deployments exist
    if [[ "$SERVICE" == "all" ]]; then
        for svc in relayer resolver frontend; do
            kubectl get deployment fusion-bitcoin-${svc} -n $NAMESPACE >/dev/null 2>&1 || error_exit "Deployment fusion-bitcoin-${svc} does not exist"
        done
    else
        kubectl get deployment fusion-bitcoin-${SERVICE} -n $NAMESPACE >/dev/null 2>&1 || error_exit "Deployment fusion-bitcoin-${SERVICE} does not exist"
    fi
    
    # Check rollout history
    if [[ "$SERVICE" == "all" ]]; then
        for svc in relayer resolver frontend; do
            HISTORY_COUNT=$(kubectl rollout history deployment/fusion-bitcoin-${svc} -n $NAMESPACE 2>/dev/null | wc -l)
            if [[ $HISTORY_COUNT -lt 3 ]]; then
                log_warning "Deployment fusion-bitcoin-${svc} has limited rollback history"
            fi
        done
    else
        HISTORY_COUNT=$(kubectl rollout history deployment/fusion-bitcoin-${SERVICE} -n $NAMESPACE 2>/dev/null | wc -l)
        if [[ $HISTORY_COUNT -lt 3 ]]; then
            log_warning "Deployment fusion-bitcoin-${SERVICE} has limited rollback history"
        fi
    fi
    
    log_success "Prerequisites check completed"
}

# Create backup of current state
create_backup() {
    log_step "💾 Creating Current State Backup"
    
    BACKUP_DIR="backups/rollback-$(date +%Y%m%d-%H%M%S)"
    mkdir -p $BACKUP_DIR
    
    # Backup current deployment manifests
    if [[ "$SERVICE" == "all" ]]; then
        for svc in relayer resolver frontend; do
            kubectl get deployment fusion-bitcoin-${svc} -n $NAMESPACE -o yaml > $BACKUP_DIR/deployment-${svc}.yaml
        done
    else
        kubectl get deployment fusion-bitcoin-${SERVICE} -n $NAMESPACE -o yaml > $BACKUP_DIR/deployment-${SERVICE}.yaml
    fi
    
    # Backup ConfigMaps and Secrets
    kubectl get configmap fusion-bitcoin-config -n $NAMESPACE -o yaml > $BACKUP_DIR/configmap.yaml 2>/dev/null || true
    kubectl get secret fusion-bitcoin-secrets -n $NAMESPACE -o yaml > $BACKUP_DIR/secret.yaml 2>/dev/null || true
    
    # Create rollback info file
    cat > $BACKUP_DIR/rollback-info.yaml << EOF
rollback_info:
  timestamp: $(date -u)
  namespace: $NAMESPACE
  service: $SERVICE
  target_revision: $ROLLBACK_REVISION
  target_version: $ROLLBACK_VERSION
  initiated_by: $(whoami)
  reason: "Manual rollback via script"
EOF
    
    log_success "Backup created at: $BACKUP_DIR"
    echo "BACKUP_DIR=$BACKUP_DIR" > /tmp/fusion-rollback-backup-path
}

# Stop health checks and monitoring
pause_monitoring() {
    log_step "⏸️ Pausing Health Checks and Monitoring"
    
    # Scale down health checker if it exists
    if kubectl get deployment health-checker -n $NAMESPACE >/dev/null 2>&1; then
        kubectl scale deployment/health-checker --replicas=0 -n $NAMESPACE || log_warning "Failed to scale down health checker"
    fi
    
    # Temporarily disable monitoring alerts (if using Prometheus)
    if kubectl get servicemonitor fusion-bitcoin-servicemonitor -n $NAMESPACE >/dev/null 2>&1; then
        kubectl annotate servicemonitor fusion-bitcoin-servicemonitor -n $NAMESPACE monitoring.coreos.com/ignore="true" --overwrite || log_warning "Failed to disable monitoring"
    fi
    
    log_success "Monitoring paused during rollback"
}

# Perform the rollback
perform_rollback() {
    log_step "🔄 Performing Rollback"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN MODE: Would execute the following rollback commands:"
        
        if [[ "$SERVICE" == "all" ]]; then
            for svc in relayer resolver frontend; do
                if [[ -n "$ROLLBACK_VERSION" ]]; then
                    echo "  kubectl set image deployment/fusion-bitcoin-${svc} ${svc}=registry.example.com/fusion-bitcoin-${svc}:${ROLLBACK_VERSION} -n $NAMESPACE"
                else
                    echo "  kubectl rollout undo deployment/fusion-bitcoin-${svc} -n $NAMESPACE --to-revision=${ROLLBACK_REVISION}"
                fi
            done
        else
            if [[ -n "$ROLLBACK_VERSION" ]]; then
                echo "  kubectl set image deployment/fusion-bitcoin-${SERVICE} ${SERVICE}=registry.example.com/fusion-bitcoin-${SERVICE}:${ROLLBACK_VERSION} -n $NAMESPACE"
            else
                echo "  kubectl rollout undo deployment/fusion-bitcoin-${SERVICE} -n $NAMESPACE --to-revision=${ROLLBACK_REVISION}"
            fi
        fi
        
        log_info "DRY RUN completed. Use without --dry-run to execute."
        return
    fi
    
    # Actual rollback execution
    if [[ "$SERVICE" == "all" ]]; then
        for svc in relayer resolver frontend; do
            log_info "Rolling back $svc..."
            
            if [[ -n "$ROLLBACK_VERSION" ]]; then
                # Rollback to specific version
                kubectl set image deployment/fusion-bitcoin-${svc} ${svc}=registry.example.com/fusion-bitcoin-${svc}:${ROLLBACK_VERSION} -n $NAMESPACE || error_exit "Failed to rollback $svc to version $ROLLBACK_VERSION"
            else
                # Rollback to previous revision
                kubectl rollout undo deployment/fusion-bitcoin-${svc} -n $NAMESPACE --to-revision=${ROLLBACK_REVISION} || error_exit "Failed to rollback $svc to revision $ROLLBACK_REVISION"
            fi
        done
    else
        log_info "Rolling back $SERVICE..."
        
        if [[ -n "$ROLLBACK_VERSION" ]]; then
            kubectl set image deployment/fusion-bitcoin-${SERVICE} ${SERVICE}=registry.example.com/fusion-bitcoin-${SERVICE}:${ROLLBACK_VERSION} -n $NAMESPACE || error_exit "Failed to rollback $SERVICE to version $ROLLBACK_VERSION"
        else
            kubectl rollout undo deployment/fusion-bitcoin-${SERVICE} -n $NAMESPACE --to-revision=${ROLLBACK_REVISION} || error_exit "Failed to rollback $SERVICE to revision $ROLLBACK_REVISION"
        fi
    fi
    
    log_success "Rollback commands executed"
}

# Wait for rollback completion
wait_for_rollback() {
    log_step "⏳ Waiting for Rollback Completion"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Skipping rollback wait"
        return
    fi
    
    # Wait for each service to complete rollback
    if [[ "$SERVICE" == "all" ]]; then
        for svc in relayer resolver frontend; do
            log_info "Waiting for $svc rollback to complete..."
            kubectl rollout status deployment/fusion-bitcoin-${svc} -n $NAMESPACE --timeout=600s || error_exit "Rollback of $svc failed or timed out"
        done
    else
        log_info "Waiting for $SERVICE rollback to complete..."
        kubectl rollout status deployment/fusion-bitcoin-${SERVICE} -n $NAMESPACE --timeout=600s || error_exit "Rollback of $SERVICE failed or timed out"
    fi
    
    log_success "Rollback completed successfully"
}

# Run post-rollback health checks
run_health_checks() {
    if [[ "$SKIP_HEALTH_CHECK" == "true" || "$DRY_RUN" == "true" ]]; then
        log_info "Skipping health checks"
        return
    fi
    
    log_step "🏥 Running Post-Rollback Health Checks"
    
    # Wait for pods to be fully ready
    log_info "Waiting for pods to be ready..."
    sleep 30
    
    # Check pod status
    kubectl wait --for=condition=ready pod -l app=fusion-bitcoin-bridge -n $NAMESPACE --timeout=300s || error_exit "Pods are not ready after rollback"
    
    # Run health checks on each service
    if [[ "$SERVICE" == "all" ]]; then
        services=("relayer" "resolver" "frontend")
    else
        services=("$SERVICE")
    fi
    
    for svc in "${services[@]}"; do
        log_info "Checking $svc health..."
        
        # Get the port for the service
        case $svc in
            relayer) port=3000 ;;
            resolver) port=3001 ;;
            frontend) port=3002 ;;
        esac
        
        # Wait a bit more for service to be fully ready
        sleep 10
        
        # Health check
        kubectl exec -n $NAMESPACE deployment/fusion-bitcoin-${svc} -- curl -f http://localhost:${port}/health --max-time 10 || log_warning "$svc health check failed"
    done
    
    # Run comprehensive health check if available
    if command -v npm >/dev/null 2>&1 && [[ -f "package.json" ]]; then
        log_info "Running comprehensive health check..."
        npm run health-check $ENVIRONMENT || log_warning "Comprehensive health check failed"
    fi
    
    log_success "Health checks completed"
}

# Resume monitoring
resume_monitoring() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Would resume monitoring"
        return
    fi
    
    log_step "▶️ Resuming Monitoring and Health Checks"
    
    # Re-enable monitoring alerts
    if kubectl get servicemonitor fusion-bitcoin-servicemonitor -n $NAMESPACE >/dev/null 2>&1; then
        kubectl annotate servicemonitor fusion-bitcoin-servicemonitor -n $NAMESPACE monitoring.coreos.com/ignore- || log_warning "Failed to re-enable monitoring"
    fi
    
    # Scale up health checker
    if kubectl get deployment health-checker -n $NAMESPACE >/dev/null 2>&1; then
        kubectl scale deployment/health-checker --replicas=1 -n $NAMESPACE || log_warning "Failed to scale up health checker"
    fi
    
    log_success "Monitoring resumed"
}

# Send rollback notification
send_notification() {
    if [[ "$DRY_RUN" == "true" ]]; then
        return
    fi
    
    log_step "📢 Sending Rollback Notification"
    
    ROLLBACK_TARGET=""
    if [[ -n "$ROLLBACK_VERSION" ]]; then
        ROLLBACK_TARGET="version $ROLLBACK_VERSION"
    else
        ROLLBACK_TARGET="revision $ROLLBACK_REVISION"
    fi
    
    if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🔄 Production rollback completed!\n• Service: $SERVICE\n• Target: $ROLLBACK_TARGET\n• Namespace: $NAMESPACE\n• Timestamp: $(date -u)\n• Initiated by: $(whoami)\"}" \
            "$SLACK_WEBHOOK_URL" || log_warning "Failed to send Slack notification"
    fi
    
    log_success "Rollback notification sent"
}

# Print rollback summary
print_summary() {
    log_step "📋 Rollback Summary"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${BLUE}DRY RUN COMPLETED - No changes were made${NC}"
        return
    fi
    
    echo -e "${GREEN}Rollback completed successfully!${NC}"
    echo -e "• Service: $SERVICE"
    echo -e "• Target: $([ -n "$ROLLBACK_VERSION" ] && echo "version $ROLLBACK_VERSION" || echo "revision $ROLLBACK_REVISION")"
    echo -e "• Namespace: $NAMESPACE"
    echo -e "• Timestamp: $(date -u)"
    echo ""
    
    echo -e "${BLUE}Current Service Status:${NC}"
    kubectl get pods -n $NAMESPACE -l app=fusion-bitcoin-bridge
    echo ""
    
    echo -e "${BLUE}Deployment History:${NC}"
    if [[ "$SERVICE" == "all" ]]; then
        for svc in relayer resolver frontend; do
            echo -e "\n${YELLOW}fusion-bitcoin-${svc}:${NC}"
            kubectl rollout history deployment/fusion-bitcoin-${svc} -n $NAMESPACE | tail -3
        done
    else
        kubectl rollout history deployment/fusion-bitcoin-${SERVICE} -n $NAMESPACE | tail -3
    fi
    echo ""
    
    # Show backup location
    if [[ -f "/tmp/fusion-rollback-backup-path" ]]; then
        BACKUP_LOCATION=$(cat /tmp/fusion-rollback-backup-path | cut -d'=' -f2)
        echo -e "${BLUE}Backup Location:${NC} $BACKUP_LOCATION"
        echo ""
    fi
    
    echo -e "${BLUE}Next Steps:${NC}"
    echo -e "1. Monitor application logs for any issues"
    echo -e "2. Verify all functionality is working correctly"
    echo -e "3. Investigate the root cause of the original issue"
    echo -e "4. Plan and test fixes before the next deployment"
    echo ""
    
    echo -e "${GREEN}🎉 Rollback completed successfully!${NC}"
}

# Cleanup function
cleanup() {
    # Clean up temporary files
    rm -f /tmp/fusion-rollback-backup-path
}

# Main rollback function
main() {
    log_step "🔄 Starting Production Rollback"
    
    # Parse command line arguments
    parse_arguments "$@"
    
    log_info "Service: $SERVICE"
    log_info "Target: $([ -n "$ROLLBACK_VERSION" ] && echo "version $ROLLBACK_VERSION" || echo "revision $ROLLBACK_REVISION")"
    log_info "Namespace: $NAMESPACE"
    log_info "Dry Run: $DRY_RUN"
    
    # Confirmation prompt (skip in emergency mode or dry run)
    if [[ "$EMERGENCY" != "true" && "$DRY_RUN" != "true" ]]; then
        echo ""
        read -p "Are you sure you want to rollback in PRODUCTION? This will affect live users. (y/N): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Rollback cancelled by user"
            exit 0
        fi
    fi
    
    # Record rollback start time
    ROLLBACK_START=$(date +%s)
    
    # Execute rollback steps
    get_deployment_status
    check_prerequisites
    
    if [[ "$DRY_RUN" != "true" ]]; then
        create_backup
        pause_monitoring
    fi
    
    perform_rollback
    wait_for_rollback
    run_health_checks
    
    if [[ "$DRY_RUN" != "true" ]]; then
        resume_monitoring
        send_notification
    fi
    
    # Calculate rollback time
    ROLLBACK_END=$(date +%s)
    ROLLBACK_TIME=$((ROLLBACK_END - ROLLBACK_START))
    
    print_summary
    
    if [[ "$DRY_RUN" != "true" ]]; then
        log_success "Total rollback time: $((ROLLBACK_TIME / 60)) minutes and $((ROLLBACK_TIME % 60)) seconds"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi