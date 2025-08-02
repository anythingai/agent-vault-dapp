#!/bin/bash

# Local Development Environment Management Script
# Manages Docker Compose stack for Fusion Bitcoin Bridge local development

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOCKER_COMPOSE_DIR="${PROJECT_ROOT}/infrastructure/docker-compose"

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
Usage: $0 [COMMAND] [OPTIONS]

Manage local development environment for Fusion Bitcoin Bridge.

COMMANDS:
    start       Start all services
    stop        Stop all services
    restart     Restart all services
    build       Build all images
    logs        Show logs for services
    status      Show status of services
    clean       Clean up containers and volumes
    reset       Reset entire environment (clean + start)
    shell       Open shell in service container
    test        Run health checks on all services
    backup      Create backup of local data
    restore     Restore from backup

OPTIONS:
    -s, --service SERVICE   Target specific service (postgres, redis, relayer, resolver, frontend)
    -f, --follow           Follow logs (for logs command)
    -d, --detach           Run in background
    -v, --verbose          Enable verbose output
    -h, --help             Show this help message

EXAMPLES:
    $0 start                    # Start all services
    $0 logs -s relayer -f       # Follow logs for relayer service
    $0 shell -s postgres        # Open shell in postgres container
    $0 clean                    # Clean up everything
    $0 backup                   # Backup local data

EOF
}

# Default values
COMMAND=""
SERVICE=""
FOLLOW=false
DETACH=false
VERBOSE=false

# Parse command line arguments
if [[ $# -gt 0 ]]; then
    COMMAND="$1"
    shift
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--service)
            SERVICE="$2"
            shift 2
            ;;
        -f|--follow)
            FOLLOW=true
            shift
            ;;
        -d|--detach)
            DETACH=true
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

# Enable verbose mode if requested
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Check if Docker Compose is installed
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check if .env file exists
    if [[ ! -f "${DOCKER_COMPOSE_DIR}/.env" ]]; then
        log_warning ".env file not found. Creating from .env.example..."
        cp "${DOCKER_COMPOSE_DIR}/.env.example" "${DOCKER_COMPOSE_DIR}/.env"
        log_info "Please edit ${DOCKER_COMPOSE_DIR}/.env with your configuration"
    fi
    
    log_success "Prerequisites check completed"
}

# Docker Compose command wrapper
docker_compose() {
    cd "$DOCKER_COMPOSE_DIR"
    
    if command -v docker-compose &> /dev/null; then
        docker-compose "$@"
    else
        docker compose "$@"
    fi
}

# Start services
start_services() {
    log_info "Starting local development environment..."
    
    cd "$DOCKER_COMPOSE_DIR"
    
    # Create required directories
    mkdir -p logs data/postgres data/redis ssl
    
    # Start services
    if [[ -n "$SERVICE" ]]; then
        log_info "Starting service: $SERVICE"
        docker_compose up ${DETACH:+-d} "$SERVICE"
    else
        log_info "Starting all services"
        docker_compose up ${DETACH:+-d}
    fi
    
    if [[ "$DETACH" == "true" ]]; then
        log_success "Services started in background"
        show_status
    else
        log_success "Services started"
    fi
}

# Stop services
stop_services() {
    log_info "Stopping services..."
    
    if [[ -n "$SERVICE" ]]; then
        log_info "Stopping service: $SERVICE"
        docker_compose stop "$SERVICE"
    else
        log_info "Stopping all services"
        docker_compose stop
    fi
    
    log_success "Services stopped"
}

# Restart services
restart_services() {
    log_info "Restarting services..."
    
    if [[ -n "$SERVICE" ]]; then
        log_info "Restarting service: $SERVICE"
        docker_compose restart "$SERVICE"
    else
        log_info "Restarting all services"
        docker_compose restart
    fi
    
    log_success "Services restarted"
}

# Build images
build_images() {
    log_info "Building images..."
    
    if [[ -n "$SERVICE" ]]; then
        log_info "Building image for service: $SERVICE"
        docker_compose build "$SERVICE"
    else
        log_info "Building all images"
        docker_compose build
    fi
    
    log_success "Images built successfully"
}

# Show logs
show_logs() {
    log_info "Showing logs..."
    
    local follow_flag=""
    if [[ "$FOLLOW" == "true" ]]; then
        follow_flag="-f"
    fi
    
    if [[ -n "$SERVICE" ]]; then
        docker_compose logs $follow_flag "$SERVICE"
    else
        docker_compose logs $follow_flag
    fi
}

# Show status
show_status() {
    log_info "Service status:"
    docker_compose ps
    
    echo
    log_info "Docker system information:"
    docker system df
    
    echo
    log_info "Network information:"
    docker network ls | grep fusion-bitcoin || log_warning "Fusion Bitcoin network not found"
}

# Clean up environment
clean_environment() {
    log_warning "This will remove all containers and volumes. Data will be lost!"
    read -p "Are you sure? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "Operation cancelled"
        exit 0
    fi
    
    log_info "Cleaning up environment..."
    
    # Stop and remove containers
    docker_compose down -v --remove-orphans
    
    # Remove images
    docker_compose down --rmi all 2>/dev/null || true
    
    # Remove unused networks
    docker network prune -f
    
    # Remove unused volumes
    docker volume prune -f
    
    log_success "Environment cleaned up"
}

# Reset environment
reset_environment() {
    log_info "Resetting environment..."
    clean_environment
    start_services
    log_success "Environment reset completed"
}

# Open shell in container
open_shell() {
    if [[ -z "$SERVICE" ]]; then
        log_error "Service name is required for shell command. Use -s option."
        exit 1
    fi
    
    log_info "Opening shell in $SERVICE container..."
    
    # Check if container is running
    if ! docker_compose ps "$SERVICE" | grep -q "Up"; then
        log_error "Service $SERVICE is not running"
        exit 1
    fi
    
    case "$SERVICE" in
        postgres)
            docker_compose exec "$SERVICE" psql -U fusionbitcoin -d fusion_bitcoin
            ;;
        redis)
            docker_compose exec "$SERVICE" redis-cli
            ;;
        *)
            docker_compose exec "$SERVICE" /bin/bash
            ;;
    esac
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."
    
    local failed_checks=0
    
    # Check each service
    for service in postgres redis relayer resolver frontend; do
        log_info "Checking $service..."
        
        if docker_compose ps "$service" | grep -q "Up"; then
            case "$service" in
                postgres)
                    if docker_compose exec -T postgres pg_isready -U fusionbitcoin &>/dev/null; then
                        log_success "$service is healthy"
                    else
                        log_error "$service health check failed"
                        ((failed_checks++))
                    fi
                    ;;
                redis)
                    if docker_compose exec -T redis redis-cli ping | grep -q "PONG"; then
                        log_success "$service is healthy"
                    else
                        log_error "$service health check failed"
                        ((failed_checks++))
                    fi
                    ;;
                relayer|resolver|frontend)
                    local port
                    case "$service" in
                        relayer) port=3000 ;;
                        resolver) port=3001 ;;
                        frontend) port=3002 ;;
                    esac
                    
                    if curl -f "http://localhost:$port/health" &>/dev/null; then
                        log_success "$service is healthy"
                    else
                        log_error "$service health check failed"
                        ((failed_checks++))
                    fi
                    ;;
            esac
        else
            log_error "$service is not running"
            ((failed_checks++))
        fi
    done
    
    if [[ $failed_checks -eq 0 ]]; then
        log_success "All health checks passed"
    else
        log_error "$failed_checks health checks failed"
        exit 1
    fi
}

# Backup local data
backup_data() {
    log_info "Creating backup of local data..."
    
    local backup_dir="${DOCKER_COMPOSE_DIR}/backups"
    local backup_file="${backup_dir}/fusion-bitcoin-backup-$(date +%Y%m%d_%H%M%S).tar.gz"
    
    mkdir -p "$backup_dir"
    
    # Create database dump
    if docker_compose ps postgres | grep -q "Up"; then
        log_info "Backing up PostgreSQL database..."
        docker_compose exec -T postgres pg_dump -U fusionbitcoin fusion_bitcoin > "${backup_dir}/postgres_dump.sql"
    fi
    
    # Create Redis dump
    if docker_compose ps redis | grep -q "Up"; then
        log_info "Backing up Redis data..."
        docker_compose exec -T redis redis-cli --rdb - > "${backup_dir}/redis_dump.rdb"
    fi
    
    # Create archive
    tar -czf "$backup_file" -C "${DOCKER_COMPOSE_DIR}" data logs backups/postgres_dump.sql backups/redis_dump.rdb 2>/dev/null || true
    
    # Cleanup temporary files
    rm -f "${backup_dir}/postgres_dump.sql" "${backup_dir}/redis_dump.rdb"
    
    log_success "Backup created: $backup_file"
}

# Restore from backup
restore_data() {
    log_error "Restore functionality not yet implemented"
    log_info "Please manually restore from backup files in ${DOCKER_COMPOSE_DIR}/backups/"
}

# Main execution
main() {
    check_prerequisites
    
    case "$COMMAND" in
        start)
            start_services
            ;;
        stop)
            stop_services
            ;;
        restart)
            restart_services
            ;;
        build)
            build_images
            ;;
        logs)
            show_logs
            ;;
        status)
            show_status
            ;;
        clean)
            clean_environment
            ;;
        reset)
            reset_environment
            ;;
        shell)
            open_shell
            ;;
        test)
            run_health_checks
            ;;
        backup)
            backup_data
            ;;
        restore)
            restore_data
            ;;
        "")
            log_error "Command is required"
            usage
            exit 1
            ;;
        *)
            log_error "Unknown command: $COMMAND"
            usage
            exit 1
            ;;
    esac
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"