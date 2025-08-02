#!/bin/bash

# Health Check and Monitoring Script for Fusion Bitcoin Bridge
# Performs comprehensive health checks on infrastructure and applications

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

Perform health checks on Fusion Bitcoin Bridge infrastructure and applications.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (local, staging, production)
    -t, --type TYPE                  Check type (infrastructure, application, all)
    -o, --output FORMAT              Output format (text, json, prometheus)
    -f, --file FILE                  Output file (default: stdout)
    -w, --wait-time SECONDS          Wait time between checks (default: 5)
    -r, --retries COUNT              Number of retries for failed checks (default: 3)
    -v, --verbose                    Enable verbose output
    -c, --continuous                 Run continuous monitoring
    -a, --alerts                     Send alerts on failures
    -h, --help                       Show this help message

CHECK TYPES:
    infrastructure  Check AWS resources, databases, networks
    application     Check application endpoints, services
    all            Perform all checks (default)

EXAMPLES:
    $0 -e production -t all
    $0 -e staging -t infrastructure -o json -f health-report.json
    $0 -e local -c -w 30

EOF
}

# Default values
ENVIRONMENT=""
CHECK_TYPE="all"
OUTPUT_FORMAT="text"
OUTPUT_FILE=""
WAIT_TIME=5
RETRIES=3
VERBOSE=false
CONTINUOUS=false
SEND_ALERTS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -t|--type)
            CHECK_TYPE="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        -f|--file)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        -w|--wait-time)
            WAIT_TIME="$2"
            shift 2
            ;;
        -r|--retries)
            RETRIES="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -c|--continuous)
            CONTINUOUS=true
            shift
            ;;
        -a|--alerts)
            SEND_ALERTS=true
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

if [[ ! "$CHECK_TYPE" =~ ^(infrastructure|application|all)$ ]]; then
    log_error "Invalid check type: $CHECK_TYPE. Must be one of: infrastructure, application, all"
    exit 1
fi

if [[ ! "$OUTPUT_FORMAT" =~ ^(text|json|prometheus)$ ]]; then
    log_error "Invalid output format: $OUTPUT_FORMAT. Must be one of: text, json, prometheus"
    exit 1
fi

# Enable verbose mode if requested
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

# Global variables for tracking results
declare -A HEALTH_RESULTS
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Initialize health check tracking
init_health_check() {
    HEALTH_RESULTS=()
    TOTAL_CHECKS=0
    PASSED_CHECKS=0
    FAILED_CHECKS=0
}

# Record health check result
record_result() {
    local component=$1
    local status=$2
    local message=$3
    local response_time=${4:-0}
    
    HEALTH_RESULTS["$component"]="$status|$message|$response_time"
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    
    if [[ "$status" == "PASS" ]]; then
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
        log_success "$component: $message"
    else
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        log_error "$component: $message"
    fi
}

# Check AWS CLI connectivity
check_aws_connectivity() {
    log_info "Checking AWS connectivity..."
    
    local start_time=$(date +%s%N)
    if aws sts get-caller-identity &> /dev/null; then
        local end_time=$(date +%s%N)
        local response_time=$(( (end_time - start_time) / 1000000 ))
        record_result "AWS_CLI" "PASS" "AWS CLI connectivity OK" "$response_time"
    else
        record_result "AWS_CLI" "FAIL" "AWS CLI connectivity failed" "0"
    fi
}

# Check RDS database connectivity
check_database_health() {
    log_info "Checking database health..."
    
    local db_endpoint=""
    case $ENVIRONMENT in
        "local")
            db_endpoint="localhost:5432"
            ;;
        "staging")
            db_endpoint="fusion-bitcoin-staging-db.us-west-2.rds.amazonaws.com:5432"
            ;;
        "production")
            db_endpoint="fusion-bitcoin-prod-db.us-west-2.rds.amazonaws.com:5432"
            ;;
    esac
    
    local start_time=$(date +%s%N)
    if timeout 10 bash -c "</dev/tcp/${db_endpoint%:*}/${db_endpoint#*:}" 2>/dev/null; then
        local end_time=$(date +%s%N)
        local response_time=$(( (end_time - start_time) / 1000000 ))
        record_result "DATABASE" "PASS" "Database connectivity OK" "$response_time"
    else
        record_result "DATABASE" "FAIL" "Database connectivity failed" "0"
    fi
}

# Check Redis connectivity
check_redis_health() {
    log_info "Checking Redis health..."
    
    local redis_endpoint=""
    case $ENVIRONMENT in
        "local")
            redis_endpoint="localhost:6379"
            ;;
        "staging")
            redis_endpoint="fusion-bitcoin-staging-redis.abc123.cache.amazonaws.com:6379"
            ;;
        "production")
            redis_endpoint="fusion-bitcoin-prod-redis.xyz789.cache.amazonaws.com:6379"
            ;;
    esac
    
    local start_time=$(date +%s%N)
    if timeout 10 bash -c "</dev/tcp/${redis_endpoint%:*}/${redis_endpoint#*:}" 2>/dev/null; then
        local end_time=$(date +%s%N)
        local response_time=$(( (end_time - start_time) / 1000000 ))
        record_result "REDIS" "PASS" "Redis connectivity OK" "$response_time"
    else
        record_result "REDIS" "FAIL" "Redis connectivity failed" "0"
    fi
}

# Check EKS cluster health
check_eks_health() {
    if ! command -v kubectl &> /dev/null; then
        record_result "EKS_CLUSTER" "SKIP" "kubectl not available"
        return
    fi
    
    log_info "Checking EKS cluster health..."
    
    local start_time=$(date +%s%N)
    if kubectl cluster-info &> /dev/null; then
        local end_time=$(date +%s%N)
        local response_time=$(( (end_time - start_time) / 1000000 ))
        
        # Check node status
        local ready_nodes=$(kubectl get nodes --no-headers | grep -c "Ready" || echo "0")
        local total_nodes=$(kubectl get nodes --no-headers | wc -l || echo "0")
        
        if [[ "$ready_nodes" -gt 0 ]] && [[ "$ready_nodes" -eq "$total_nodes" ]]; then
            record_result "EKS_CLUSTER" "PASS" "EKS cluster healthy ($ready_nodes/$total_nodes nodes ready)" "$response_time"
        else
            record_result "EKS_CLUSTER" "FAIL" "EKS cluster unhealthy ($ready_nodes/$total_nodes nodes ready)" "$response_time"
        fi
    else
        record_result "EKS_CLUSTER" "FAIL" "EKS cluster connectivity failed" "0"
    fi
}

# Check application endpoints
check_application_endpoints() {
    log_info "Checking application endpoints..."
    
    local base_url=""
    case $ENVIRONMENT in
        "local")
            base_url="http://localhost"
            ;;
        "staging")
            base_url="https://staging.fusion-bitcoin.1inch.io"
            ;;
        "production")
            base_url="https://fusion-bitcoin.1inch.io"
            ;;
    esac
    
    # Check relayer service
    check_endpoint "$base_url:3000/health" "RELAYER"
    
    # Check resolver service
    check_endpoint "$base_url:3001/health" "RESOLVER"
    
    # Check frontend service
    check_endpoint "$base_url:3002/health" "FRONTEND"
}

# Check individual endpoint
check_endpoint() {
    local url=$1
    local component=$2
    local max_retries=${3:-$RETRIES}
    
    for ((i=1; i<=max_retries; i++)); do
        local start_time=$(date +%s%N)
        local http_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" --connect-timeout 10 --max-time 30 || echo "000")
        local end_time=$(date +%s%N)
        local response_time=$(( (end_time - start_time) / 1000000 ))
        
        if [[ "$http_code" == "200" ]]; then
            record_result "$component" "PASS" "Endpoint healthy (HTTP $http_code)" "$response_time"
            return
        elif [[ i -lt max_retries ]]; then
            log_warning "$component: Attempt $i failed (HTTP $http_code), retrying..."
            sleep 2
        fi
    done
    
    record_result "$component" "FAIL" "Endpoint unhealthy (HTTP $http_code)" "$response_time"
}

# Check Kubernetes pods
check_kubernetes_pods() {
    if ! command -v kubectl &> /dev/null; then
        record_result "K8S_PODS" "SKIP" "kubectl not available"
        return
    fi
    
    log_info "Checking Kubernetes pods..."
    
    local namespace="fusion-bitcoin"
    if [[ "$ENVIRONMENT" != "production" ]]; then
        namespace="fusion-bitcoin-${ENVIRONMENT}"
    fi
    
    # Check if namespace exists
    if ! kubectl get namespace "$namespace" &> /dev/null; then
        record_result "K8S_PODS" "FAIL" "Namespace $namespace does not exist"
        return
    fi
    
    local total_pods=$(kubectl get pods -n "$namespace" --no-headers 2>/dev/null | wc -l || echo "0")
    local ready_pods=$(kubectl get pods -n "$namespace" --no-headers 2>/dev/null | grep -c "Running\|Completed" || echo "0")
    local failed_pods=$(kubectl get pods -n "$namespace" --no-headers 2>/dev/null | grep -c "Error\|CrashLoopBackOff\|Failed" || echo "0")
    
    if [[ "$total_pods" -eq 0 ]]; then
        record_result "K8S_PODS" "FAIL" "No pods found in namespace $namespace"
    elif [[ "$failed_pods" -gt 0 ]]; then
        record_result "K8S_PODS" "FAIL" "Pods unhealthy ($ready_pods ready, $failed_pods failed out of $total_pods total)"
    else
        record_result "K8S_PODS" "PASS" "All pods healthy ($ready_pods/$total_pods ready)"
    fi
}

# Check SSL certificates
check_ssl_certificates() {
    if [[ "$ENVIRONMENT" == "local" ]]; then
        record_result "SSL_CERT" "SKIP" "SSL check skipped for local environment"
        return
    fi
    
    log_info "Checking SSL certificates..."
    
    local domain=""
    case $ENVIRONMENT in
        "staging")
            domain="staging.fusion-bitcoin.1inch.io"
            ;;
        "production")
            domain="fusion-bitcoin.1inch.io"
            ;;
    esac
    
    local expiry_date=$(echo | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null | \
                       openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    
    if [[ -n "$expiry_date" ]]; then
        local expiry_epoch=$(date -d "$expiry_date" +%s)
        local current_epoch=$(date +%s)
        local days_remaining=$(( (expiry_epoch - current_epoch) / 86400 ))
        
        if [[ "$days_remaining" -gt 30 ]]; then
            record_result "SSL_CERT" "PASS" "SSL certificate valid (expires in $days_remaining days)"
        elif [[ "$days_remaining" -gt 7 ]]; then
            record_result "SSL_CERT" "WARN" "SSL certificate expires soon ($days_remaining days)"
        else
            record_result "SSL_CERT" "FAIL" "SSL certificate expires very soon ($days_remaining days)"
        fi
    else
        record_result "SSL_CERT" "FAIL" "Could not retrieve SSL certificate information"
    fi
}

# Check monitoring systems
check_monitoring_systems() {
    log_info "Checking monitoring systems..."
    
    # Check Prometheus
    if [[ "$ENVIRONMENT" == "local" ]]; then
        check_endpoint "http://localhost:9090/-/ready" "PROMETHEUS"
    else
        # For staging/production, Prometheus would be internal
        record_result "PROMETHEUS" "SKIP" "Internal monitoring system"
    fi
    
    # Check Grafana
    if [[ "$ENVIRONMENT" == "local" ]]; then
        check_endpoint "http://localhost:3000/api/health" "GRAFANA"
    else
        record_result "GRAFANA" "SKIP" "Internal monitoring system"
    fi
}
# Send alerts if enabled
send_alerts() {
    if [[ "$SEND_ALERTS" == "false" ]] || [[ "$FAILED_CHECKS" -eq 0 ]]; then
        return
    fi
    
    log_info "Sending health check alerts..."
    
    # Send alert to configured channels (Slack, email, etc.)
    # This would typically integrate with your alerting system
    local alert_message="Health check failed for $ENVIRONMENT environment. $FAILED_CHECKS/$TOTAL_CHECKS checks failed."
    
    # Example webhook notification (customize for your alerting system)
    if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data '{"text":"'"$alert_message"'"}' \
            "$SLACK_WEBHOOK_URL" &> /dev/null || true
    fi
    
    log_info "Alerts sent for $FAILED_CHECKS failed checks"
}

# Main execution
main() {
    init_health_check
    
    case "$CHECK_TYPE" in
        infrastructure)
            check_aws_connectivity
            check_database_health
            check_redis_health
            check_eks_health
            check_kubernetes_pods
            check_ssl_certificates
            check_monitoring_systems
            ;;
        application)
            check_application_endpoints
            check_kubernetes_pods
            ;;
        all)
            check_aws_connectivity
            check_database_health
            check_redis_health
            check_eks_health
            check_application_endpoints
            check_kubernetes_pods
            check_ssl_certificates
            check_monitoring_systems
            ;;
    esac
    
    # Send alerts if enabled
    send_alerts
    
    # Output results summary
    echo
    log_info "Health Check Summary:"
    log_info "Total Checks: $TOTAL_CHECKS"
    log_success "Passed: $PASSED_CHECKS"
    if [[ "$FAILED_CHECKS" -gt 0 ]]; then
        log_error "Failed: $FAILED_CHECKS"
    fi
    
    # Exit with appropriate code
    if [[ "$FAILED_CHECKS" -gt 0 ]]; then
        log_error "Health checks failed!"
        exit 1
    else
        log_success "All health checks passed!"
        exit 0
    fi
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"
    
