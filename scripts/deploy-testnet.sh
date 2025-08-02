#!/bin/bash

# Testnet (Sepolia) Deployment Script
# This script deploys the 1inch Fusion+ Cross-Chain Bitcoin Bridge to Sepolia testnet

set -e  # Exit on any error
set -o pipefail  # Exit on pipe failures

# Configuration
ENVIRONMENT="testnet"
NETWORK="sepolia"
VERSION=${VERSION:-"testnet-$(date +%Y%m%d-%H%M%S)"}
REGISTRY=${REGISTRY:-"registry.example.com"}
NAMESPACE="fusion-bitcoin-testnet"

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
    log_error "Testnet deployment failed. Please check the logs and fix any issues."
    exit 1
}

# Check prerequisites for testnet deployment
check_testnet_prerequisites() {
    log_step "🔍 Checking Testnet Deployment Prerequisites"
    
    # Check if required tools are installed
    command -v kubectl >/dev/null 2>&1 || error_exit "kubectl is required but not installed"
    command -v docker >/dev/null 2>&1 || error_exit "docker is required but not installed"
    command -v npm >/dev/null 2>&1 || error_exit "npm is required but not installed"
    command -v jq >/dev/null 2>&1 || error_exit "jq is required but not installed"
    
    # Check if kubectl is configured for testnet cluster
    if ! kubectl cluster-info >/dev/null 2>&1; then
        error_exit "kubectl is not configured or testnet cluster is not accessible"
    fi
    
    # Verify cluster context
    CURRENT_CONTEXT=$(kubectl config current-context)
    log_info "Current kubectl context: $CURRENT_CONTEXT"
    
    # Check if we can build and push Docker images
    docker info >/dev/null 2>&1 || error_exit "Docker daemon is not running or not accessible"
    
    # Test registry connectivity
    if ! docker info | grep -q "Registry"; then
        log_warning "Docker registry connectivity could not be verified"
    fi
    
    log_success "All testnet prerequisites are met"
}

# Validate testnet environment configuration
validate_testnet_environment() {
    log_step "🔧 Validating Testnet Environment Configuration"
    
    # Check if testnet environment file exists
    if [[ ! -f ".env.testnet" ]]; then
        log_warning ".env.testnet file not found, creating from template"
        if [[ -f ".env.example" ]]; then
            cp .env.example .env.testnet
            
            # Update with testnet-specific defaults
            cat >> .env.testnet << EOF

# Testnet Environment Configuration
NODE_ENV=staging
ENVIRONMENT=testnet
NETWORK=sepolia

# Testnet blockchain connections
ETH_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
ETH_CHAIN_ID=11155111
ETH_NETWORK=sepolia

# Bitcoin testnet
BTC_NETWORK=testnet
BTC_RPC_URL=https://testnet-bitcoind.example.com

# Testnet database
DB_HOST=fusion-bitcoin-postgres-testnet.example.com
DB_NAME=fusion_bitcoin_testnet
DB_SSL_MODE=require

# Testnet service configuration
RELAYER_PORT=3000
RESOLVER_PORT=3001
FRONTEND_PORT=3002

# Security settings for testnet
HTTPS_ENABLED=true
CORS_ENABLED=true
RATE_LIMITING_ENABLED=true

# Monitoring and logging
METRICS_ENABLED=true
LOG_LEVEL=info
SENTRY_ENVIRONMENT=testnet

# Testnet specific flags
USE_TEST_DATA=false
SKIP_MAINNET_CHECKS=true
EOF
            
            log_error "Please update .env.testnet with actual testnet configuration values before continuing"
            exit 1
        else
            error_exit ".env.example file not found. Cannot create testnet environment configuration."
        fi
    fi
    
    # Load environment variables
    set -a
    source .env.testnet
    set +a
    
    # Validate required testnet environment variables
    local required_vars=(
        "ETH_RPC_URL"
        "ETH_PRIVATE_KEY"
        "DB_HOST"
        "DB_USERNAME"
        "DB_PASSWORD"
        "ETHERSCAN_API_KEY"
    )
    
    local missing_vars=()
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing required environment variables:"
        printf '  - %s\n' "${missing_vars[@]}"
        error_exit "Please set all required environment variables in .env.testnet"
    fi
    
    # Run configuration validation
    log_info "Running configuration validation..."
    npm run validate-config testnet || error_exit "Configuration validation failed"
    
    # Run deployment readiness check
    log_info "Running testnet deployment readiness assessment..."
    npm run deployment-readiness testnet || error_exit "Testnet deployment readiness check failed"
    
    # Validate Ethereum connectivity
    log_info "Testing Ethereum Sepolia connectivity..."
    CHAIN_ID=$(curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        $ETH_RPC_URL | jq -r '.result')
    
    if [[ "$CHAIN_ID" != "0x2aa2" ]]; then  # 11155111 in hex
        error_exit "Ethereum RPC is not connected to Sepolia testnet (got chain ID: $CHAIN_ID)"
    fi
    
    log_success "Testnet environment configuration is valid"
}

# Build and push Docker images for testnet
build_and_push_testnet_images() {
    log_step "🐳 Building and Pushing Testnet Docker Images"
    
    # Build application for testnet
    log_info "Building application for testnet..."
    npm ci || error_exit "Failed to install dependencies"
    npm run build:testnet || error_exit "Testnet build failed"
    
    # Build Docker images with testnet tag
    log_info "Building Docker images..."
    
    # Build relayer image
    log_info "Building relayer image for testnet..."
    docker build -t ${REGISTRY}/fusion-bitcoin-relayer:${VERSION} \
        --build-arg NODE_ENV=staging \
        --build-arg ENVIRONMENT=testnet \
        -f docker/Dockerfile.relayer . || error_exit "Failed to build relayer image"
    
    # Build resolver image
    log_info "Building resolver image for testnet..."
    docker build -t ${REGISTRY}/fusion-bitcoin-resolver:${VERSION} \
        --build-arg NODE_ENV=staging \
        --build-arg ENVIRONMENT=testnet \
        -f docker/Dockerfile.resolver . || error_exit "Failed to build resolver image"
    
    # Build frontend image
    log_info "Building frontend image for testnet..."
    docker build -t ${REGISTRY}/fusion-bitcoin-frontend:${VERSION} \
        --build-arg NODE_ENV=staging \
        --build-arg ENVIRONMENT=testnet \
        --build-arg VITE_API_BASE_URL=https://api-testnet.fusion-bitcoin.example.com \
        --build-arg VITE_ENVIRONMENT=testnet \
        -f docker/Dockerfile.frontend . || error_exit "Failed to build frontend image"
    
    # Push images to registry
    log_info "Pushing testnet images to registry..."
    docker push ${REGISTRY}/fusion-bitcoin-relayer:${VERSION} || error_exit "Failed to push relayer image"
    docker push ${REGISTRY}/fusion-bitcoin-resolver:${VERSION} || error_exit "Failed to push resolver image"
    docker push ${REGISTRY}/fusion-bitcoin-frontend:${VERSION} || error_exit "Failed to push frontend image"
    
    # Tag as testnet-latest
    docker tag ${REGISTRY}/fusion-bitcoin-relayer:${VERSION} ${REGISTRY}/fusion-bitcoin-relayer:testnet-latest
    docker tag ${REGISTRY}/fusion-bitcoin-resolver:${VERSION} ${REGISTRY}/fusion-bitcoin-resolver:testnet-latest
    docker tag ${REGISTRY}/fusion-bitcoin-frontend:${VERSION} ${REGISTRY}/fusion-bitcoin-frontend:testnet-latest
    
    docker push ${REGISTRY}/fusion-bitcoin-relayer:testnet-latest
    docker push ${REGISTRY}/fusion-bitcoin-resolver:testnet-latest
    docker push ${REGISTRY}/fusion-bitcoin-frontend:testnet-latest
    
    log_success "Testnet Docker images built and pushed successfully"
}

# Deploy smart contracts to Sepolia testnet
deploy_testnet_contracts() {
    log_step "📜 Deploying Smart Contracts to Sepolia Testnet"
    
    if [[ -d "contracts" ]]; then
        cd contracts
        
        # Install dependencies
        npm ci || error_exit "Failed to install contract dependencies"
        
        # Compile contracts
        log_info "Compiling contracts for testnet..."
        npm run build || error_exit "Failed to compile contracts"
        
        # Run contract tests
        log_info "Running contract tests..."
        npm run test || error_exit "Contract tests failed"
        
        # Deploy to Sepolia testnet
        log_info "Deploying contracts to Sepolia testnet..."
        npx hardhat run scripts/deploy-enhanced.js --network sepolia || error_exit "Contract deployment to testnet failed"
        
        # Verify contracts on Etherscan
        log_info "Verifying contracts on Etherscan..."
        npm run verify --network sepolia || log_warning "Contract verification failed, but deployment continues"
        
        # Update deployment record
        if [[ -f "deployments/sepolia/addresses.json" ]]; then
            # Copy to main deployment directory
            cp deployments/sepolia/addresses.json ../deployment/sepolia-addresses.json
            
            # Update configuration
            cp deployments/sepolia/addresses.json ../config/contract-addresses/testnet.json
            
            log_info "Contract deployment completed and addresses updated"
            
            # Display deployed contract addresses
            log_info "Deployed contract addresses:"
            jq -r 'to_entries[] | "  \(.key): \(.value)"' ../deployment/sepolia-addresses.json
        fi
        
        cd ..
        log_success "Smart contracts deployed successfully to Sepolia testnet"
    else
        log_info "No contracts directory found, skipping contract deployment"
    fi
}

# Setup Kubernetes resources for testnet
setup_testnet_kubernetes() {
    log_step "☸️ Setting Up Testnet Kubernetes Resources"
    
    # Create testnet namespace
    log_info "Creating testnet namespace..."
    kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -
    
    # Wait for namespace to be ready
    kubectl wait --for=condition=Ready namespace/${NAMESPACE} --timeout=60s || error_exit "Testnet namespace not ready"
    
    # Apply ConfigMaps with testnet configuration
    log_info "Applying testnet ConfigMaps..."
    envsubst < k8s/configmap.yaml | sed "s/fusion-bitcoin/fusion-bitcoin-testnet/g" | kubectl apply -f - -n ${NAMESPACE}
    
    # Apply Secrets (placeholder - should be managed by external secrets manager)
    log_info "Applying testnet Secrets..."
    
    # Create secrets from environment variables
    kubectl create secret generic fusion-bitcoin-testnet-secrets \
        --from-literal=eth-private-key="${ETH_PRIVATE_KEY}" \
        --from-literal=btc-private-key="${BTC_PRIVATE_KEY:-}" \
        --from-literal=db-password="${DB_PASSWORD}" \
        --from-literal=jwt-secret="${JWT_SECRET}" \
        --from-literal=session-secret="${SESSION_SECRET}" \
        --from-literal=api-secret-key="${API_SECRET_KEY}" \
        --from-literal=etherscan-api-key="${ETHERSCAN_API_KEY}" \
        --namespace=${NAMESPACE} \
        --dry-run=client -o yaml | kubectl apply -f -
    
    # Apply Services
    log_info "Applying testnet Services..."
    envsubst < k8s/services.yaml | sed "s/fusion-bitcoin/fusion-bitcoin-testnet/g" | kubectl apply -f - -n ${NAMESPACE}
    
    log_success "Testnet Kubernetes base resources created successfully"
}

# Run database migrations for testnet
run_testnet_migrations() {
    log_step "💾 Running Testnet Database Migrations"
    
    if [[ -n "$DB_HOST" && -n "$DB_NAME" ]]; then
        log_info "Testing testnet database connectivity..."
        
        # Test database connectivity using a temporary pod
        kubectl run db-migration-test --image=postgres:15-alpine --rm -i --restart=Never --namespace=${NAMESPACE} -- \
            pg_isready -h ${DB_HOST} -p ${DB_PORT:-5432} || error_exit "Testnet database is not accessible"
        
        log_info "Database is accessible, running migrations..."
        
        # Create migration job for testnet
        cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: fusion-bitcoin-testnet-migration-${VERSION//./-}
  namespace: ${NAMESPACE}
spec:
  template:
    spec:
      serviceAccountName: fusion-bitcoin-testnet-service-account
      restartPolicy: Never
      containers:
      - name: migration
        image: ${REGISTRY}/fusion-bitcoin-relayer:${VERSION}
        command: ["npm", "run", "db:migrate"]
        env:
        - name: NODE_ENV
          value: "staging"
        - name: ENVIRONMENT
          value: "testnet"
        envFrom:
        - configMapRef:
            name: fusion-bitcoin-testnet-config
        - secretRef:
            name: fusion-bitcoin-testnet-secrets
      backoffLimit: 3
EOF
        
        # Wait for migration to complete
        kubectl wait --for=condition=complete job/fusion-bitcoin-testnet-migration-${VERSION//./-} \
            --namespace=${NAMESPACE} --timeout=300s || error_exit "Testnet database migration failed"
        
        # Check migration logs
        kubectl logs job/fusion-bitcoin-testnet-migration-${VERSION//./-} --namespace=${NAMESPACE}
        
        log_success "Testnet database migrations completed successfully"
    else
        log_info "No database configuration found, skipping migrations"
    fi
}

# Deploy testnet application services
deploy_testnet_services() {
    log_step "🚀 Deploying Testnet Application Services"
    
    # Update image tags in deployment manifests for testnet
    log_info "Updating deployment manifests for testnet with version ${VERSION}..."
    
    # Create testnet-specific deployment manifest
    cp k8s/deployments.yaml k8s/deployments-testnet.yaml
    
    # Update with testnet configuration
    sed -i.bak "s|{{VERSION}}|${VERSION}|g" k8s/deployments-testnet.yaml
    sed -i.bak "s|registry.example.com|${REGISTRY}|g" k8s/deployments-testnet.yaml
    sed -i.bak "s|fusion-bitcoin|fusion-bitcoin-testnet|g" k8s/deployments-testnet.yaml
    sed -i.bak "s|replicas: 3|replicas: 2|g" k8s/deployments-testnet.yaml  # Fewer replicas for testnet
    
    # Apply testnet deployments
    log_info "Applying testnet deployments..."
    kubectl apply -f k8s/deployments-testnet.yaml -n ${NAMESPACE} || error_exit "Failed to apply testnet deployments"
    
    # Wait for rollout to complete
    log_info "Waiting for testnet deployments to be ready..."
    
    kubectl rollout status deployment/fusion-bitcoin-testnet-relayer --namespace=${NAMESPACE} --timeout=600s || error_exit "Testnet relayer deployment failed"
    kubectl rollout status deployment/fusion-bitcoin-testnet-resolver --namespace=${NAMESPACE} --timeout=600s || error_exit "Testnet resolver deployment failed"
    kubectl rollout status deployment/fusion-bitcoin-testnet-frontend --namespace=${NAMESPACE} --timeout=600s || error_exit "Testnet frontend deployment failed"
    
    log_success "Testnet application services deployed successfully"
}

# Setup testnet ingress and SSL
setup_testnet_ingress() {
    log_step "🌐 Setting Up Testnet Ingress and SSL"
    
    # Create testnet-specific ingress configuration
    cp k8s/ingress.yaml k8s/ingress-testnet.yaml
    
    # Update with testnet hostnames and configuration
    sed -i.bak "s|fusion-bitcoin.1inch.io|testnet.fusion-bitcoin.example.com|g" k8s/ingress-testnet.yaml
    sed -i.bak "s|api.fusion-bitcoin.1inch.io|api-testnet.fusion-bitcoin.example.com|g" k8s/ingress-testnet.yaml
    sed -i.bak "s|fusion-bitcoin|fusion-bitcoin-testnet|g" k8s/ingress-testnet.yaml
    
    # Apply testnet ingress configuration
    log_info "Applying testnet ingress configuration..."
    kubectl apply -f k8s/ingress-testnet.yaml -n ${NAMESPACE} || error_exit "Failed to apply testnet ingress configuration"
    
    # Wait for ingress to get an IP address
    log_info "Waiting for testnet ingress to get external IP..."
    timeout=300
    while [[ $timeout -gt 0 ]]; do
        EXTERNAL_IP=$(kubectl get ingress fusion-bitcoin-testnet-ingress --namespace=${NAMESPACE} -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        if [[ -n "$EXTERNAL_IP" && "$EXTERNAL_IP" != "<pending>" ]]; then
            log_success "Testnet ingress got external IP: $EXTERNAL_IP"
            break
        fi
        sleep 10
        timeout=$((timeout - 10))
    done
    
    if [[ -z "$EXTERNAL_IP" || "$EXTERNAL_IP" == "<pending>" ]]; then
        log_warning "Testnet ingress didn't get external IP within timeout, but continuing deployment"
    fi
    
    # Check SSL certificate status
    log_info "Checking testnet SSL certificate status..."
    kubectl describe certificate fusion-bitcoin-testnet-cert --namespace=${NAMESPACE} || log_warning "SSL certificate not found, manual configuration may be required"
    
    log_success "Testnet ingress configuration applied successfully"
}

# Run testnet health checks
run_testnet_health_checks() {
    log_step "🏥 Running Testnet Health Checks"
    
    # Wait for pods to be fully ready
    log_info "Waiting for all testnet pods to be ready..."
    kubectl wait --for=condition=ready pod -l app=fusion-bitcoin-testnet-bridge --namespace=${NAMESPACE} --timeout=300s || error_exit "Testnet pods are not ready"
    
    # Run application health checks
    log_info "Running testnet health checks..."
    sleep 30  # Give services time to fully initialize
    
    # Check service health endpoints
    for service in relayer resolver frontend; do
        log_info "Checking testnet ${service} health..."
        
        # Get service port
        SERVICE_PORT=$(kubectl get svc fusion-bitcoin-testnet-${service} -n ${NAMESPACE} -o jsonpath='{.spec.ports[0].port}')
        
        # Port forward to test health endpoint
        kubectl port-forward svc/fusion-bitcoin-testnet-${service} ${SERVICE_PORT}:${SERVICE_PORT} -n ${NAMESPACE} &
        PF_PID=$!
        
        sleep 5
        
        if curl -f http://localhost:${SERVICE_PORT}/health >/dev/null 2>&1; then
            log_success "Testnet ${service} health check passed"
        else
            log_warning "Testnet ${service} health check failed"
        fi
        
        kill $PF_PID 2>/dev/null || true
    done
    
    # Run comprehensive health check script
    log_info "Running comprehensive testnet health check..."
    npm run health-check testnet || log_warning "Comprehensive testnet health check failed, but deployment continues"
    
    log_success "Testnet health checks completed"
}

# Run testnet integration tests
run_testnet_tests() {
    log_step "🧪 Running Testnet Integration Tests"
    
    log_info "Running testnet integration tests..."
    npm run test:integration:testnet || log_warning "Some testnet integration tests failed"
    
    log_info "Running testnet end-to-end tests..."
    npm run test:e2e:testnet || log_warning "Some testnet e2e tests failed"
    
    log_success "Testnet tests completed"
}

# Send testnet deployment notification
send_testnet_notification() {
    log_step "📢 Sending Testnet Deployment Notification"
    
    if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🧪 Testnet deployment completed successfully!\n• Version: ${VERSION}\n• Environment: ${ENVIRONMENT}\n• Network: ${NETWORK}\n• Timestamp: $(date -u)\n• Frontend: https://testnet.fusion-bitcoin.example.com\n• API: https://api-testnet.fusion-bitcoin.example.com\"}" \
            "$SLACK_WEBHOOK_URL" || log_warning "Failed to send Slack notification"
        log_success "Slack notification sent"
    fi
}

# Print testnet deployment summary
print_testnet_summary() {
    log_step "📋 Testnet Deployment Summary"
    
    echo -e "${GREEN}🎉 Testnet deployment completed successfully!${NC}"
    echo -e "• Version: ${VERSION}"
    echo -e "• Environment: ${ENVIRONMENT}"
    echo -e "• Network: ${NETWORK}"
    echo -e "• Namespace: ${NAMESPACE}"
    echo -e "• Timestamp: $(date -u)"
    echo ""
    
    echo -e "${BLUE}Service Status:${NC}"
    kubectl get pods -n ${NAMESPACE} -l app=fusion-bitcoin-testnet-bridge
    echo ""
    
    echo -e "${BLUE}Service URLs:${NC}"
    EXTERNAL_IP=$(kubectl get ingress fusion-bitcoin-testnet-ingress --namespace=${NAMESPACE} -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
    echo -e "• Frontend: https://testnet.fusion-bitcoin.example.com (IP: ${EXTERNAL_IP})"
    echo -e "• API: https://api-testnet.fusion-bitcoin.example.com"
    echo ""
    
    echo -e "${BLUE}Contract Addresses:${NC}"
    if [[ -f "deployment/sepolia-addresses.json" ]]; then
        jq -r 'to_entries[] | "• \(.key): \(.value)"' deployment/sepolia-addresses.json
    fi
    echo ""
    
    echo -e "${BLUE}Next Steps:${NC}"
    echo -e "1. Update DNS records to point to ${EXTERNAL_IP}"
    echo -e "2. Run comprehensive tests: npm run test:testnet:full"
    echo -e "3. Monitor deployment: kubectl logs -f deployment/fusion-bitcoin-testnet-relayer -n ${NAMESPACE}"
    echo -e "4. Check metrics: kubectl port-forward svc/fusion-bitcoin-testnet-metrics 9090:9090 -n ${NAMESPACE}"
    echo ""
    
    echo -e "${GREEN}🚀 Testnet is ready for testing!${NC}"
}

# Main testnet deployment function
main() {
    log_step "🧪 Starting Testnet (Sepolia) Deployment"
    log_info "Environment: ${ENVIRONMENT}"
    log_info "Network: ${NETWORK}"
    log_info "Version: ${VERSION}"
    log_info "Namespace: ${NAMESPACE}"
    log_info "Registry: ${REGISTRY}"
    
    # Confirmation prompt
    echo ""
    read -p "Deploy to TESTNET (Sepolia)? This will use real testnet resources. (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Testnet deployment cancelled by user"
        exit 0
    fi
    
    # Record deployment start time
    DEPLOYMENT_START=$(date +%s)
    
    # Execute deployment steps
    check_testnet_prerequisites
    validate_testnet_environment
    build_and_push_testnet_images
    deploy_testnet_contracts
    setup_testnet_kubernetes
    run_testnet_migrations
    deploy_testnet_services
    setup_testnet_ingress
    run_testnet_health_checks
    run_testnet_tests
    send_testnet_notification
    
    # Calculate deployment time
    DEPLOYMENT_END=$(date +%s)
    DEPLOYMENT_TIME=$((DEPLOYMENT_END - DEPLOYMENT_START))
    
    print_testnet_summary
    log_success "Total testnet deployment time: $((DEPLOYMENT_TIME / 60)) minutes and $((DEPLOYMENT_TIME % 60)) seconds"
}

# Cleanup function
cleanup_testnet() {
    log_info "Cleaning up testnet deployment artifacts..."
    
    # Remove temporary files
    rm -f k8s/deployments-testnet.yaml.bak k8s/ingress-testnet.yaml.bak k8s/deployments-testnet.yaml k8s/ingress-testnet.yaml
}

# Set trap to cleanup on exit
trap cleanup_testnet EXIT

# Run main function
main "$@"