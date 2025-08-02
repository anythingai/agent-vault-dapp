#!/bin/bash

# Local Development Deployment Script
# This script sets up the entire 1inch Fusion+ Cross-Chain Bitcoin Bridge in local development environment

set -e  # Exit on any error
set -o pipefail  # Exit on pipe failures

# Configuration
ENVIRONMENT="local"
VERSION=${VERSION:-"dev-$(date +%Y%m%d-%H%M%S)"}
LOCAL_REGISTRY=${LOCAL_REGISTRY:-"localhost:5000"}

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
    log_error "Local deployment failed. Please check the logs and fix any issues."
    exit 1
}

# Check prerequisites for local development
check_local_prerequisites() {
    log_step "🔍 Checking Local Development Prerequisites"
    
    # Check if required tools are installed
    command -v node >/dev/null 2>&1 || error_exit "Node.js is required but not installed"
    command -v npm >/dev/null 2>&1 || error_exit "npm is required but not installed"
    command -v docker >/dev/null 2>&1 || error_exit "Docker is required but not installed"
    command -v docker-compose >/dev/null 2>&1 || error_exit "Docker Compose is required but not installed"
    
    # Check Node.js version
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ $NODE_VERSION -lt 16 ]]; then
        error_exit "Node.js version 16 or higher is required"
    fi
    
    # Check if Docker daemon is running
    docker info >/dev/null 2>&1 || error_exit "Docker daemon is not running"
    
    log_success "All local prerequisites are met"
}

# Setup local environment
setup_local_environment() {
    log_step "🔧 Setting Up Local Development Environment"
    
    # Create local environment file if it doesn't exist
    if [[ ! -f ".env.local" ]]; then
        log_info "Creating local environment configuration..."
        cp .env.example .env.local
        
        # Update with local development defaults
        cat >> .env.local << EOF

# Local Development Overrides
NODE_ENV=development
LOG_LEVEL=debug
METRICS_ENABLED=true
HEALTH_CHECK_ENABLED=true

# Local blockchain connections
ETH_RPC_URL=http://localhost:8545
BTC_RPC_URL=http://localhost:18443

# Local database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fusion_bitcoin_dev
DB_USERNAME=fusion_dev
DB_PASSWORD=dev_password

# Local service ports
RELAYER_PORT=3000
RESOLVER_PORT=3001
FRONTEND_PORT=3002
METRICS_PORT=9090

# Development flags
USE_TEST_DATA=true
ENABLE_CORS=true
COMPRESSION_ENABLED=false
EOF
        
        log_info "Please review and update .env.local with your local configuration"
    fi
    
    # Load environment variables
    set -a
    source .env.local
    set +a
    
    log_success "Local environment configuration ready"
}

# Start local blockchain networks
start_local_blockchains() {
    log_step "⛓️ Starting Local Blockchain Networks"
    
    # Start local Ethereum network (Hardhat)
    log_info "Starting local Ethereum network..."
    if [[ -d "contracts" ]]; then
        cd contracts
        
        # Check if hardhat is already running
        if ! curl -s http://localhost:8545 >/dev/null; then
            npm install >/dev/null 2>&1 || error_exit "Failed to install contract dependencies"
            
            # Start Hardhat network in background
            npx hardhat node --hostname 0.0.0.0 --port 8545 > ../logs/hardhat.log 2>&1 &
            HARDHAT_PID=$!
            echo $HARDHAT_PID > ../logs/hardhat.pid
            
            # Wait for Hardhat to be ready
            log_info "Waiting for Hardhat network to be ready..."
            timeout=60
            while [[ $timeout -gt 0 ]]; do
                if curl -s http://localhost:8545 >/dev/null; then
                    break
                fi
                sleep 2
                timeout=$((timeout - 2))
            done
            
            if [[ $timeout -eq 0 ]]; then
                error_exit "Hardhat network failed to start"
            fi
            
            log_success "Local Ethereum network started (PID: $HARDHAT_PID)"
        else
            log_info "Local Ethereum network already running"
        fi
        
        cd ..
    fi
    
    # Start local Bitcoin regtest network using Docker
    log_info "Starting local Bitcoin regtest network..."
    
    if ! docker ps | grep -q bitcoin-regtest; then
        docker run -d \
            --name bitcoin-regtest \
            --rm \
            -p 18443:18443 \
            -p 18444:18444 \
            -e BITCOIN_NETWORK=regtest \
            -e BITCOIN_RPC_USER=bitcoin \
            -e BITCOIN_RPC_PASSWORD=bitcoin \
            -v $(pwd)/data/bitcoin:/home/bitcoin/.bitcoin \
            lncm/bitcoind:v25.0 \
            -regtest \
            -server \
            -rpcbind=0.0.0.0:18443 \
            -rpcallowip=0.0.0.0/0 \
            -rpcuser=bitcoin \
            -rpcpassword=bitcoin \
            > logs/bitcoin-regtest.log 2>&1
        
        # Wait for Bitcoin node to be ready
        log_info "Waiting for Bitcoin regtest network to be ready..."
        timeout=60
        while [[ $timeout -gt 0 ]]; do
            if docker exec bitcoin-regtest bitcoin-cli -regtest getblockchaininfo >/dev/null 2>&1; then
                break
            fi
            sleep 2
            timeout=$((timeout - 2))
        done
        
        if [[ $timeout -eq 0 ]]; then
            error_exit "Bitcoin regtest network failed to start"
        fi
        
        # Generate some initial blocks
        docker exec bitcoin-regtest bitcoin-cli -regtest generatetoaddress 101 $(docker exec bitcoin-regtest bitcoin-cli -regtest getnewaddress)
        
        log_success "Local Bitcoin regtest network started"
    else
        log_info "Local Bitcoin regtest network already running"
    fi
}

# Setup local database
setup_local_database() {
    log_step "💾 Setting Up Local Database"
    
    # Start PostgreSQL using Docker Compose
    log_info "Starting local PostgreSQL database..."
    
    cat > docker-compose.dev.yml << EOF
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: fusion-bitcoin-postgres-dev
    environment:
      POSTGRES_DB: \${DB_NAME}
      POSTGRES_USER: \${DB_USERNAME}
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    ports:
      - "\${DB_PORT}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/init:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${DB_USERNAME} -d \${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: fusion-bitcoin-redis-dev
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
EOF
    
    # Start database services
    docker-compose -f docker-compose.dev.yml up -d
    
    # Wait for database to be ready
    log_info "Waiting for database to be ready..."
    timeout=60
    while [[ $timeout -gt 0 ]]; do
        if docker-compose -f docker-compose.dev.yml exec -T postgres pg_isready -U ${DB_USERNAME} -d ${DB_NAME} >/dev/null 2>&1; then
            break
        fi
        sleep 2
        timeout=$((timeout - 2))
    done
    
    if [[ $timeout -eq 0 ]]; then
        error_exit "Database failed to start"
    fi
    
    log_success "Local database started and ready"
}

# Deploy smart contracts to local network
deploy_local_contracts() {
    log_step "📜 Deploying Smart Contracts to Local Network"
    
    if [[ -d "contracts" ]]; then
        cd contracts
        
        log_info "Compiling contracts..."
        npm run build || error_exit "Contract compilation failed"
        
        log_info "Running contract tests..."
        npm run test || error_exit "Contract tests failed"
        
        log_info "Deploying contracts to local network..."
        npx hardhat run scripts/deploy-enhanced.js --network localhost || error_exit "Contract deployment failed"
        
        # Copy deployment addresses
        if [[ -f "deployments/localhost/addresses.json" ]]; then
            cp deployments/localhost/addresses.json ../config/contract-addresses/local.json
            log_success "Contract addresses updated in configuration"
        fi
        
        cd ..
        log_success "Smart contracts deployed successfully"
    else
        log_info "No contracts directory found, skipping contract deployment"
    fi
}

# Install dependencies and build services
build_local_services() {
    log_step "🔨 Building Local Services"
    
    # Install root dependencies
    log_info "Installing root dependencies..."
    npm ci || error_exit "Failed to install root dependencies"
    
    # Install backend dependencies
    if [[ -d "backend" ]]; then
        log_info "Installing backend dependencies..."
        cd backend
        npm ci || error_exit "Failed to install backend dependencies"
        cd ..
    fi
    
    # Install frontend dependencies
    if [[ -d "frontend" ]]; then
        log_info "Installing frontend dependencies..."
        cd frontend
        npm ci || error_exit "Failed to install frontend dependencies"
        cd ..
    fi
    
    # Build TypeScript services
    log_info "Building TypeScript services..."
    npm run build:dev || error_exit "Failed to build services"
    
    log_success "Local services built successfully"
}

# Start local services
start_local_services() {
    log_step "🚀 Starting Local Services"
    
    # Create logs directory
    mkdir -p logs
    
    # Start relayer service
    log_info "Starting relayer service..."
    NODE_ENV=development npm run dev:relayer > logs/relayer.log 2>&1 &
    RELAYER_PID=$!
    echo $RELAYER_PID > logs/relayer.pid
    
    # Start resolver service
    log_info "Starting resolver service..."
    NODE_ENV=development npm run dev:resolver > logs/resolver.log 2>&1 &
    RESOLVER_PID=$!
    echo $RESOLVER_PID > logs/resolver.pid
    
    # Start frontend service
    if [[ -d "frontend" ]]; then
        log_info "Starting frontend service..."
        cd frontend
        npm run dev > ../logs/frontend.log 2>&1 &
        FRONTEND_PID=$!
        echo $FRONTEND_PID > ../logs/frontend.pid
        cd ..
    fi
    
    # Wait for services to be ready
    log_info "Waiting for services to be ready..."
    sleep 10
    
    # Health check services
    local services_ready=true
    
    if ! curl -f http://localhost:${RELAYER_PORT}/health >/dev/null 2>&1; then
        log_warning "Relayer service health check failed"
        services_ready=false
    fi
    
    if ! curl -f http://localhost:${RESOLVER_PORT}/health >/dev/null 2>&1; then
        log_warning "Resolver service health check failed"
        services_ready=false
    fi
    
    if [[ -d "frontend" ]] && ! curl -f http://localhost:${FRONTEND_PORT} >/dev/null 2>&1; then
        log_warning "Frontend service health check failed"
        services_ready=false
    fi
    
    if [[ "$services_ready" == "true" ]]; then
        log_success "All services started successfully"
    else
        log_warning "Some services may not be fully ready yet. Check logs for details."
    fi
}

# Run local tests
run_local_tests() {
    log_step "🧪 Running Local Integration Tests"
    
    log_info "Running unit tests..."
    npm run test:unit || log_warning "Some unit tests failed"
    
    log_info "Running integration tests..."
    npm run test:integration:local || log_warning "Some integration tests failed"
    
    log_success "Local tests completed"
}

# Create stop script
create_stop_script() {
    log_step "📝 Creating Stop Script"
    
    cat > scripts/stop-local.sh << 'EOF'
#!/bin/bash

# Stop Local Development Environment

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_info "🛑 Stopping local development environment..."

# Stop services
if [[ -f "logs/relayer.pid" ]]; then
    RELAYER_PID=$(cat logs/relayer.pid)
    kill $RELAYER_PID 2>/dev/null && log_info "Stopped relayer service (PID: $RELAYER_PID)"
    rm logs/relayer.pid
fi

if [[ -f "logs/resolver.pid" ]]; then
    RESOLVER_PID=$(cat logs/resolver.pid)
    kill $RESOLVER_PID 2>/dev/null && log_info "Stopped resolver service (PID: $RESOLVER_PID)"
    rm logs/resolver.pid
fi

if [[ -f "logs/frontend.pid" ]]; then
    FRONTEND_PID=$(cat logs/frontend.pid)
    kill $FRONTEND_PID 2>/dev/null && log_info "Stopped frontend service (PID: $FRONTEND_PID)"
    rm logs/frontend.pid
fi

# Stop Hardhat network
if [[ -f "logs/hardhat.pid" ]]; then
    HARDHAT_PID=$(cat logs/hardhat.pid)
    kill $HARDHAT_PID 2>/dev/null && log_info "Stopped Hardhat network (PID: $HARDHAT_PID)"
    rm logs/hardhat.pid
fi

# Stop Docker containers
log_info "Stopping Docker containers..."
docker-compose -f docker-compose.dev.yml down -v 2>/dev/null && log_info "Stopped database containers"
docker stop bitcoin-regtest 2>/dev/null && log_info "Stopped Bitcoin regtest"

log_info "✅ Local development environment stopped"
EOF
    
    chmod +x scripts/stop-local.sh
    log_success "Stop script created at scripts/stop-local.sh"
}

# Print local deployment summary
print_local_summary() {
    log_step "📋 Local Development Environment Ready"
    
    echo -e "${GREEN}🎉 Local deployment completed successfully!${NC}"
    echo ""
    echo -e "${BLUE}Services:${NC}"
    echo -e "• Relayer API: http://localhost:${RELAYER_PORT}"
    echo -e "• Resolver API: http://localhost:${RESOLVER_PORT}"
    if [[ -d "frontend" ]]; then
        echo -e "• Frontend: http://localhost:${FRONTEND_PORT}"
    fi
    echo ""
    echo -e "${BLUE}Blockchain Networks:${NC}"
    echo -e "• Ethereum (Hardhat): http://localhost:8545"
    echo -e "• Bitcoin (Regtest): http://localhost:18443"
    echo ""
    echo -e "${BLUE}Database:${NC}"
    echo -e "• PostgreSQL: localhost:${DB_PORT}/${DB_NAME}"
    echo -e "• Redis: localhost:6379"
    echo ""
    echo -e "${BLUE}Useful Commands:${NC}"
    echo -e "• View logs: tail -f logs/<service>.log"
    echo -e "• Stop environment: ./scripts/stop-local.sh"
    echo -e "• Run tests: npm run test:integration:local"
    echo -e "• Health check: npm run health-check local"
    echo ""
    echo -e "${GREEN}🚀 Happy developing!${NC}"
}

# Main function
main() {
    log_step "🚀 Starting Local Development Environment Setup"
    log_info "Environment: ${ENVIRONMENT}"
    log_info "Version: ${VERSION}"
    
    # Create necessary directories
    mkdir -p logs data/bitcoin config/contract-addresses
    
    # Execute setup steps
    check_local_prerequisites
    setup_local_environment
    start_local_blockchains
    setup_local_database
    deploy_local_contracts
    build_local_services
    start_local_services
    run_local_tests
    create_stop_script
    
    print_local_summary
}

# Cleanup function
cleanup() {
    log_info "Cleaning up on exit..."
    # Any cleanup needed can be added here
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Run main function
main "$@"