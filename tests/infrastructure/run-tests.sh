#!/bin/bash

# Infrastructure Test Runner for Fusion Bitcoin Bridge
# Runs comprehensive infrastructure tests across all components

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

Run infrastructure tests for Fusion Bitcoin Bridge.

OPTIONS:
    -t, --test-type TYPE        Test type to run (all, terraform, kubernetes, docker, integration)
    -e, --environment ENV       Target environment (local, staging, production)
    -f, --format FORMAT         Output format (default, json, junit)
    -o, --output DIR            Output directory for reports
    -v, --verbose               Enable verbose output
    -c, --coverage              Generate coverage report
    -w, --watch                 Watch mode for development
    -s, --skip-prereqs          Skip prerequisite checks
    -h, --help                  Show this help message

TEST TYPES:
    all           Run all infrastructure tests (default)
    terraform     Terraform configuration tests
    kubernetes    Kubernetes manifest tests  
    docker        Docker Compose tests
    integration   End-to-end integration tests

EXAMPLES:
    $0                          # Run all tests
    $0 -t terraform             # Run only Terraform tests
    $0 -e local -c              # Run tests for local env with coverage
    $0 -t integration -v        # Run integration tests with verbose output

EOF
}

# Default values
TEST_TYPE="all"
ENVIRONMENT="local"
OUTPUT_FORMAT="default"
OUTPUT_DIR="${SCRIPT_DIR}/reports"
VERBOSE=false
COVERAGE=false
WATCH=false
SKIP_PREREQS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--test-type)
            TEST_TYPE="$2"
            shift 2
            ;;
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -f|--format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -c|--coverage)
            COVERAGE=true
            shift
            ;;
        -w|--watch)
            WATCH=true
            shift
            ;;
        -s|--skip-prereqs)
            SKIP_PREREQS=true
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

# Validate parameters
if [[ ! "$TEST_TYPE" =~ ^(all|terraform|kubernetes|docker|integration)$ ]]; then
    log_error "Invalid test type: $TEST_TYPE"
    usage
    exit 1
fi

if [[ ! "$ENVIRONMENT" =~ ^(local|staging|production)$ ]]; then
    log_error "Invalid environment: $ENVIRONMENT"
    exit 1
fi

log_info "Starting infrastructure tests for Fusion Bitcoin Bridge"
log_info "Test Type: $TEST_TYPE"
log_info "Environment: $ENVIRONMENT"
log_info "Output Format: $OUTPUT_FORMAT"

# Check prerequisites
check_prerequisites() {
    if [[ "$SKIP_PREREQS" == "true" ]]; then
        log_warning "Skipping prerequisite checks"
        return
    fi

    log_info "Checking prerequisites..."
    
    local missing_tools=()
    
    # Required tools
    local required_tools=("node" "npm")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    # Test-specific tools
    case "$TEST_TYPE" in
        terraform|all)
            if ! command -v terraform &> /dev/null; then
                missing_tools+=("terraform")
            fi
            ;;
        kubernetes|all)
            if ! command -v kubectl &> /dev/null; then
                missing_tools+=("kubectl")
            fi
            ;;
        docker|all)
            if ! command -v docker &> /dev/null; then
                missing_tools+=("docker")
            fi
            if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
                missing_tools+=("docker-compose")
            fi
            ;;
    esac
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_error "Please install missing tools before running tests"
        exit 1
    fi
    
    log_success "Prerequisites check completed"
}

# Setup test environment
setup_environment() {
    log_info "Setting up test environment..."
    
    cd "$SCRIPT_DIR"
    
    # Create output directory
    mkdir -p "$OUTPUT_DIR"
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        log_info "Installing test dependencies..."
        npm install --silent
    fi
    
    # Set environment variables for tests
    export TEST_ENVIRONMENT="$ENVIRONMENT"
    export PROJECT_ROOT="$PROJECT_ROOT"
    export TEST_OUTPUT_DIR="$OUTPUT_DIR"
    
    if [[ "$VERBOSE" == "true" ]]; then
        export VERBOSE_TESTS="true"
    fi
    
    log_success "Test environment setup completed"
}

# Run specific test suites
run_terraform_tests() {
    log_info "Running Terraform tests..."
    
    local jest_args="terraform/"
    if [[ "$VERBOSE" == "true" ]]; then
        jest_args="$jest_args --verbose"
    fi
    
    if [[ "$OUTPUT_FORMAT" == "junit" ]]; then
        jest_args="$jest_args --reporters=jest-junit"
        export JEST_JUNIT_OUTPUT_DIR="$OUTPUT_DIR"
        export JEST_JUNIT_OUTPUT_NAME="terraform-results.xml"
    fi
    
    npm run test:terraform -- $jest_args
}

run_kubernetes_tests() {
    log_info "Running Kubernetes tests..."
    
    local jest_args="kubernetes/"
    if [[ "$VERBOSE" == "true" ]]; then
        jest_args="$jest_args --verbose"
    fi
    
    if [[ "$OUTPUT_FORMAT" == "junit" ]]; then
        jest_args="$jest_args --reporters=jest-junit"
        export JEST_JUNIT_OUTPUT_DIR="$OUTPUT_DIR"
        export JEST_JUNIT_OUTPUT_NAME="kubernetes-results.xml"
    fi
    
    npm run test:kubernetes -- $jest_args
}

run_docker_tests() {
    log_info "Running Docker tests..."
    
    local jest_args="docker/"
    if [[ "$VERBOSE" == "true" ]]; then
        jest_args="$jest_args --verbose"
    fi
    
    if [[ "$OUTPUT_FORMAT" == "junit" ]]; then
        jest_args="$jest_args --reporters=jest-junit"
        export JEST_JUNIT_OUTPUT_DIR="$OUTPUT_DIR"
        export JEST_JUNIT_OUTPUT_NAME="docker-results.xml"
    fi
    
    npm run test:docker -- $jest_args
}

run_integration_tests() {
    log_info "Running integration tests..."
    
    local jest_args="integration/"
    if [[ "$VERBOSE" == "true" ]]; then
        jest_args="$jest_args --verbose"
    fi
    
    if [[ "$OUTPUT_FORMAT" == "junit" ]]; then
        jest_args="$jest_args --reporters=jest-junit"
        export JEST_JUNIT_OUTPUT_DIR="$OUTPUT_DIR"
        export JEST_JUNIT_OUTPUT_NAME="integration-results.xml"
    fi
    
    npm run test:integration -- $jest_args
}

run_all_tests() {
    log_info "Running all infrastructure tests..."
    
    local jest_args=""
    if [[ "$VERBOSE" == "true" ]]; then
        jest_args="$jest_args --verbose"
    fi
    
    if [[ "$COVERAGE" == "true" ]]; then
        jest_args="$jest_args --coverage"
    fi
    
    if [[ "$WATCH" == "true" ]]; then
        jest_args="$jest_args --watch"
    fi
    
    if [[ "$OUTPUT_FORMAT" == "junit" ]]; then
        jest_args="$jest_args --reporters=default --reporters=jest-junit"
        export JEST_JUNIT_OUTPUT_DIR="$OUTPUT_DIR"
        export JEST_JUNIT_OUTPUT_NAME="all-results.xml"
    fi
    
    npm test -- $jest_args
}

# Generate test report
generate_report() {
    log_info "Generating test report..."
    
    local report_file="$OUTPUT_DIR/test-summary.txt"
    
    cat > "$report_file" << EOF
# Infrastructure Test Summary
Generated: $(date)
Environment: $ENVIRONMENT
Test Type: $TEST_TYPE

## Test Results
EOF
    
    # Add Jest output summary if available
    if [[ -f "$OUTPUT_DIR/coverage/lcov-report/index.html" ]]; then
        echo "Coverage report: $OUTPUT_DIR/coverage/lcov-report/index.html" >> "$report_file"
    fi
    
    # Add JUnit results if available
    if ls "$OUTPUT_DIR"/*.xml &> /dev/null; then
        echo "JUnit reports: $OUTPUT_DIR/*.xml" >> "$report_file"
    fi
    
    log_success "Test report generated: $report_file"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up test environment..."
    
    # Remove temporary files
    find "$SCRIPT_DIR" -name "*.tmp" -delete 2>/dev/null || true
    
    # Clean up Jest cache if needed
    if [[ -d "$SCRIPT_DIR/.jest-cache" ]]; then
        rm -rf "$SCRIPT_DIR/.jest-cache"
    fi
}

# Main execution
main() {
    # Setup trap for cleanup
    trap cleanup EXIT
    
    check_prerequisites
    setup_environment
    
    case "$TEST_TYPE" in
        terraform)
            run_terraform_tests
            ;;
        kubernetes)
            run_kubernetes_tests
            ;;
        docker)
            run_docker_tests
            ;;
        integration)
            run_integration_tests
            ;;
        all)
            run_all_tests
            ;;
    esac
    
    generate_report
    
    log_success "Infrastructure tests completed successfully!"
    
    if [[ "$COVERAGE" == "true" && -f "$OUTPUT_DIR/coverage/lcov-report/index.html" ]]; then
        log_info "Coverage report available at: $OUTPUT_DIR/coverage/lcov-report/index.html"
    fi
}

# Error handling
trap 'log_error "Test execution failed at line $LINENO"' ERR

# Run main function
main "$@"