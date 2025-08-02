#!/bin/bash

# Production Deployment Script for 1inch Fusion Bitcoin Bridge
# This script handles the complete production deployment process

set -e  # Exit on any error
set -o pipefail  # Exit on pipe failures

# Configuration
NAMESPACE="fusion-bitcoin"
VERSION=${VERSION:-"1.0.0"}
REGISTRY=${REGISTRY:-"registry.example.com"}
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
    log_error "Deployment failed. Please check the logs and fix any issues."
    exit 1
}

# Check prerequisites
check_prerequisites() {
    log_step "🔍 Checking Prerequisites"
    
    # Check if required tools are installed
    command -v kubectl >/dev/null 2>&1 || error_exit "kubectl is required but not installed"
    command -v docker >/dev/null 2>&1 || error_exit "docker is required but not installed"
    command -v npm >/dev/null 2>&1 || error_exit "npm is required but not installed"
    
    # Check if kubectl is configured
    kubectl cluster-info >/dev/null 2>&1 || error_exit "kubectl is not configured or cluster is not accessible"
    
    # Check if we can build Docker images
    docker info >/dev/null 2>&1 || error_exit "Docker daemon is not running or not accessible"
    
    log_success "All prerequisites are met"
}

# Validate environment variables
validate_environment() {
    log_step "🔧 Validating Environment Configuration"
    
    # Check if environment file exists
    if [[ ! -f ".env.${ENVIRONMENT}" ]]; then
        log_warning ".env.${ENVIRONMENT} file not found, using .env.example as template"
        if [[ -f ".env.example" ]]; then
            cp .env.example .env.${ENVIRONMENT}
            log_info "Created .env.${ENVIRONMENT} from .env.example"
            log_warning "Please update .env.${ENVIRONMENT} with production values before continuing"
            read -p "Press Enter to continue after updating the environment file..."
        else
            error_exit ".env.example file not found. Cannot create environment configuration."
        fi
    fi
    
    # Load environment variables
    set -a
    source .env.${ENVIRONMENT}
    set +a
    
    # Run configuration validation
    log_info "Running configuration validation..."
    npm run validate-config ${ENVIRONMENT} || error_exit "Configuration validation failed"
    
    # Run deployment readiness check
    log_info "Running deployment readiness assessment..."
    npm run deployment-readiness ${ENVIRONMENT} || error_exit "Deployment readiness check failed"
    
    log_success "Environment configuration is valid"
}

# Build and push Docker images
build_and_push_images() {
    log_step "🐳 Building and Pushing Docker Images"
    
    # Build application
    log_info "Building application..."
    npm ci
    npm run build:production || error_exit "Application build failed"
    
    # Build Docker images
    log_info "Building Docker images..."
    
    # Relayer service
    log_info "Building relayer image..."
    docker build -t ${REGISTRY}/fusion-bitcoin-relayer:${VERSION} -f docker/Dockerfile.relayer . || error_exit "Failed to build relayer image"
    
    # Resolver service
    log_info "Building resolver image..."
    docker build -t ${REGISTRY}/fusion-bitcoin-resolver:${VERSION} -f docker/Dockerfile.resolver . || error_exit "Failed to build resolver image"
    
    # Frontend service
    log_info "Building frontend image..."
    docker build -t ${REGISTRY}/fusion-bitcoin-frontend:${VERSION} -f docker/Dockerfile.frontend . || error_exit "Failed to build frontend image"
    
    # Push images
    log_info "Pushing images to registry..."
    docker push ${REGISTRY}/fusion-bitcoin-relayer:${VERSION} || error_exit "Failed to push relayer image"
    docker push ${REGISTRY}/fusion-bitcoin-resolver:${VERSION} || error_exit "Failed to push resolver image"
    docker push ${REGISTRY}/fusion-bitcoin-frontend:${VERSION} || error_exit "Failed to push frontend image"
    
    # Tag as latest for production
    docker tag ${REGISTRY}/fusion-bitcoin-relayer:${VERSION} ${REGISTRY}/fusion-bitcoin-relayer:latest
    docker tag ${REGISTRY}/fusion-bitcoin-resolver:${VERSION} ${REGISTRY}/fusion-bitcoin-resolver:latest
    docker tag ${REGISTRY}/fusion-bitcoin-frontend:${VERSION} ${REGISTRY}/fusion-bitcoin-frontend:latest
    
    docker push ${REGISTRY}/fusion-bitcoin-relayer:latest
    docker push ${REGISTRY}/fusion-bitcoin-resolver:latest
    docker push ${REGISTRY}/fusion-bitcoin-frontend:latest
    
    log_success "Docker images built and pushed successfully"
}

# Deploy contracts (if needed)
deploy_contracts() {
    log_step "📜 Deploying Smart Contracts"
    
    if [[ -d "contracts" && -f "contracts/package.json" ]]; then
        log_info "Smart contracts directory found, deploying contracts..."
        
        cd contracts
        
        # Install dependencies
        npm ci || error_exit "Failed to install contract dependencies"
        
        # Compile contracts
        npm run build || error_exit "Failed to compile contracts"
        
        # Run tests
        npm run test || error_exit "Contract tests failed"
        
        # Deploy to network
        if [[ -n "$ETH_NETWORK" ]]; then
            log_info "Deploying contracts to ${ETH_NETWORK}..."
            npx hardhat deploy --network ${ETH_NETWORK} || error_exit "Contract deployment failed"
            
            # Verify contracts
            log_info "Verifying contracts on Etherscan..."
            npm run verify || log_warning "Contract verification failed, but deployment continues"
        else
            log_warning "ETH_NETWORK not set, skipping contract deployment"
        fi
        
        cd ..
        log_success "Smart contracts deployed successfully"
    else
        log_info "No contracts directory found, skipping contract deployment"
    fi
}

# Create namespace and apply configurations
setup_kubernetes() {
    log_step "☸️ Setting Up Kubernetes Resources"
    
    # Create namespace
    log_info "Creating namespace..."
    kubectl apply -f k8s/namespace.yaml || error_exit "Failed to create namespace"
    
    # Wait for namespace to be ready
    kubectl wait --for=condition=Ready namespace/${NAMESPACE} --timeout=60s || error_exit "Namespace not ready"
    
    # Apply ConfigMaps
    log_info "Applying ConfigMaps..."
    kubectl apply -f k8s/configmap.yaml || error_exit "Failed to apply ConfigMaps"
    
    # Apply Secrets (with placeholders - should be replaced with actual secrets)
    log_info "Applying Secrets..."
    kubectl apply -f k8s/secrets.yaml || error_exit "Failed to apply Secrets"
    
    log_warning "Remember to update the secrets with actual production values!"
    log_info "Use: kubectl edit secret fusion-bitcoin-secrets -n ${NAMESPACE}"
    
    # Apply Services
    log_info "Applying Services..."
    kubectl apply -f k8s/services.yaml || error_exit "Failed to apply Services"
    
    log_success "Kubernetes base resources created successfully"
}

# Run database migrations
run_migrations() {
    log_step "💾 Running Database Migrations"
    
    # Check if database is configured
    if [[ -n "$DB_HOST" && -n "$DB_NAME" ]]; then
        log_info "Database configuration found, checking connectivity..."
        
        # Test database connectivity using a temporary pod
        kubectl run db-test --image=postgres:15-alpine --rm -i --restart=Never --namespace=${NAMESPACE} -- \
            pg_isready -h ${DB_HOST} -p ${DB_PORT:-5432} || error_exit "Database is not accessible"
        
        log_info "Database is accessible, running migrations..."
        
        # Apply database migrations using a job
        cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: fusion-bitcoin-migration-${VERSION//./-}
  namespace: ${NAMESPACE}
spec:
  template:
    spec:
      serviceAccountName: fusion-bitcoin-service-account
      restartPolicy: Never
      containers:
      - name: migration
        image: ${REGISTRY}/fusion-bitcoin-relayer:${VERSION}
        command: ["npm", "run", "db:migrate"]
        envFrom:
        - configMapRef:
            name: fusion-bitcoin-config
        - secretRef:
            name: fusion-bitcoin-secrets
      backoffLimit: 3
EOF
        
        # Wait for migration to complete
        kubectl wait --for=condition=complete job/fusion-bitcoin-migration-${VERSION//./-} --namespace=${NAMESPACE} --timeout=300s || error_exit "Database migration failed"
        
        log_success "Database migrations completed successfully"
    else
        log_info "No database configuration found, skipping migrations"
    fi
}

# Deploy application services
deploy_services() {
    log_step "🚀 Deploying Application Services"
    
    # Update image tags in deployment manifests
    log_info "Updating deployment manifests with version ${VERSION}..."
    sed -i.bak "s|{{VERSION}}|${VERSION}|g" k8s/deployments.yaml
    sed -i.bak "s|registry.example.com|${REGISTRY}|g" k8s/deployments.yaml
    
    # Apply deployments
    log_info "Applying deployments..."
    kubectl apply -f k8s/deployments.yaml || error_exit "Failed to apply deployments"
    
    # Wait for rollout to complete
    log_info "Waiting for deployments to be ready..."
    
    kubectl rollout status deployment/fusion-bitcoin-relayer --namespace=${NAMESPACE} --timeout=600s || error_exit "Relayer deployment failed"
    kubectl rollout status deployment/fusion-bitcoin-resolver --namespace=${NAMESPACE} --timeout=600s || error_exit "Resolver deployment failed"
    kubectl rollout status deployment/fusion-bitcoin-frontend --namespace=${NAMESPACE} --timeout=600s || error_exit "Frontend deployment failed"
    
    # Wait for StatefulSet (database) if it exists
    if kubectl get statefulset fusion-bitcoin-postgres --namespace=${NAMESPACE} >/dev/null 2>&1; then
        kubectl rollout status statefulset/fusion-bitcoin-postgres --namespace=${NAMESPACE} --timeout=600s || error_exit "Database StatefulSet failed"
    fi
    
    log_success "Application services deployed successfully"
}

# Configure ingress and SSL
setup_ingress() {
    log_step "🌐 Setting Up Ingress and SSL"
    
    # Apply ingress configuration
    log_info "Applying ingress configuration..."
    kubectl apply -f k8s/ingress.yaml || error_exit "Failed to apply ingress configuration"
    
    # Wait for ingress to get an IP address
    log_info "Waiting for ingress to get external IP..."
    timeout=300
    while [[ $timeout -gt 0 ]]; do
        EXTERNAL_IP=$(kubectl get ingress fusion-bitcoin-ingress --namespace=${NAMESPACE} -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        if [[ -n "$EXTERNAL_IP" && "$EXTERNAL_IP" != "<pending>" ]]; then
            log_success "Ingress got external IP: $EXTERNAL_IP"
            break
        fi
        sleep 10
        timeout=$((timeout - 10))
    done
    
    if [[ -z "$EXTERNAL_IP" || "$EXTERNAL_IP" == "<pending>" ]]; then
        log_warning "Ingress didn't get external IP within timeout, but continuing deployment"
    fi
    
    # Check SSL certificate status
    log_info "Checking SSL certificate status..."
    kubectl describe certificate fusion-bitcoin-cert --namespace=${NAMESPACE} || log_warning "SSL certificate not found, manual configuration may be required"
    
    log_success "Ingress configuration applied successfully"
}

# Run post-deployment health checks
run_health_checks() {
    log_step "🏥 Running Post-Deployment Health Checks"
    
    # Wait for pods to be fully ready
    log_info "Waiting for all pods to be ready..."
    kubectl wait --for=condition=ready pod -l app=fusion-bitcoin-bridge --namespace=${NAMESPACE} --timeout=300s || error_exit "Pods are not ready"
    
    # Run application health checks
    log_info "Running application health checks..."
    sleep 30  # Give services time to fully initialize
    
    # Check service health endpoints
    for service in relayer resolver frontend; do
        log_info "Checking ${service} health..."
        kubectl exec -n ${NAMESPACE} deployment/fusion-bitcoin-${service} -- curl -f http://localhost:$(kubectl get svc fusion-bitcoin-${service} -n ${NAMESPACE} -o jsonpath='{.spec.ports[0].targetPort}')/health || log_warning "${service} health check failed"
    done
    
    # Run comprehensive health check script
    log_info "Running comprehensive health check..."
    npm run health-check ${ENVIRONMENT} || log_warning "Comprehensive health check failed, but deployment continues"
    
    log_success "Health checks completed"
}

# Cleanup temporary files
cleanup() {
    log_step "🧹 Cleaning Up"
    
    # Restore original deployment files
    if [[ -f "k8s/deployments.yaml.bak" ]]; then
        mv k8s/deployments.yaml.bak k8s/deployments.yaml
    fi
    
    # Clean up migration jobs older than current
    kubectl delete jobs -l app=fusion-bitcoin-bridge --namespace=${NAMESPACE} --field-selector=status.conditions[0].type!=Complete 2>/dev/null || true
    
    log_success "Cleanup completed"
}

# Send deployment notification
send_notification() {
    log_step "📢 Sending Deployment Notification"
    
    if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚀 Production deployment completed successfully!\n• Version: ${VERSION}\n• Environment: ${ENVIRONMENT}\n• Timestamp: $(date -u)\"}" \
            "$SLACK_WEBHOOK_URL" || log_warning "Failed to send Slack notification"
        log_success "Slack notification sent"
    fi
    
    if [[ -n "$TEAMS_WEBHOOK_URL" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚀 Production deployment completed successfully! Version: ${VERSION}\"}" \
            "$TEAMS_WEBHOOK_URL" || log_warning "Failed to send Teams notification"
        log_success "Teams notification sent"
    fi
}

# Print deployment summary
print_summary() {
    log_step "📋 Deployment Summary"
    
    echo -e "${GREEN}Deployment completed successfully!${NC}"
    echo -e "• Version: ${VERSION}"
    echo -e "• Environment: ${ENVIRONMENT}"
    echo -e "• Namespace: ${NAMESPACE}"
    echo -e "• Timestamp: $(date -u)"
    echo ""
    
    echo -e "${BLUE}Service Status:${NC}"
    kubectl get pods -n ${NAMESPACE} -l app=fusion-bitcoin-bridge
    echo ""
    
    echo -e "${BLUE}Service URLs:${NC}"
    EXTERNAL_IP=$(kubectl get ingress fusion-bitcoin-ingress --namespace=${NAMESPACE} -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
    echo -e "• Frontend: https://fusion-bitcoin.1inch.io (IP: ${EXTERNAL_IP})"
    echo -e "• API: https://api.fusion-bitcoin.1inch.io"
    echo ""
    
    echo -e "${BLUE}Next Steps:${NC}"
    echo -e "1. Update DNS records to point to ${EXTERNAL_IP}"
    echo -e "2. Update secrets with production values: kubectl edit secret fusion-bitcoin-secrets -n ${NAMESPACE}"
    echo -e "3. Monitor deployment: kubectl logs -f deployment/fusion-bitcoin-relayer -n ${NAMESPACE}"
    echo -e "4. Run end-to-end tests: npm run test:e2e:production"
    echo ""
    
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
}

# Main deployment function
main() {
    log_step "🚀 Starting Production Deployment"
    log_info "Version: ${VERSION}"
    log_info "Environment: ${ENVIRONMENT}"
    log_info "Namespace: ${NAMESPACE}"
    log_info "Registry: ${REGISTRY}"
    
    # Confirmation prompt
    echo ""
    read -p "Are you sure you want to deploy to PRODUCTION? This will affect live users. (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Deployment cancelled by user"
        exit 0
    fi
    
    # Record deployment start time
    DEPLOYMENT_START=$(date +%s)
    
    # Execute deployment steps
    check_prerequisites
    validate_environment
    build_and_push_images
    deploy_contracts
    setup_kubernetes
    run_migrations
    deploy_services
    setup_ingress
    run_health_checks
    cleanup
    send_notification
    
    # Calculate deployment time
    DEPLOYMENT_END=$(date +%s)
    DEPLOYMENT_TIME=$((DEPLOYMENT_END - DEPLOYMENT_START))
    
    print_summary
    log_success "Total deployment time: $((DEPLOYMENT_TIME / 60)) minutes and $((DEPLOYMENT_TIME % 60)) seconds"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Run main function
main "$@"