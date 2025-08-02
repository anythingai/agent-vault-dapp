# Bitcoin HTLC Testing Framework

A comprehensive testing framework for Bitcoin HTLC (Hash Time Lock Contract) functionality in the 1inch Fusion+ Cross-Chain Swap Extension.

## Overview

This testing framework provides complete validation of Bitcoin HTLC implementation including:

- **Unit Tests**: HTLC script creation, validation, and transaction construction
- **Integration Tests**: End-to-end cross-chain atomic swaps with Ethereum
- **Security Tests**: Attack resistance and edge case validation  
- **Performance Tests**: Load testing and benchmarking
- **CI/CD Integration**: Automated testing with GitHub Actions
- **Docker Support**: Isolated testing environments

## Architecture

```
tests/
├── bitcoin/                 # Bitcoin-specific tests
│   ├── setup.ts            # Regtest node management
│   ├── htlc.test.ts        # HTLC script tests
│   ├── transactions.test.ts # Transaction tests
│   └── security.test.ts     # Security validation
├── integration/             # Cross-chain integration tests
│   ├── setup.ts            # Cross-chain environment
│   └── atomicSwap.test.ts   # End-to-end swap tests
├── performance/             # Performance and load tests
│   └── load.test.ts        # Benchmarking suite
├── docker/                 # Docker configurations
│   └── bitcoin-regtest/    # Bitcoin regtest container
├── scripts/                # Utility scripts
│   ├── generate-reports.js # Test report generation
│   └── generate-performance-report.js
└── setup/                  # Test environment setup
    └── jest-setup.ts       # Jest configuration
```

## Requirements

### System Requirements

- **Node.js**: 18.x or 20.x
- **Bitcoin Core**: Latest version (for regtest)
- **Docker**: For containerized testing
- **Git**: For version control

### Platform Support

- ✅ Linux (Ubuntu 20.04+)
- ✅ macOS (10.15+)
- ✅ Windows (WSL2 recommended)

## Installation

### 1. Clone and Install Dependencies

```bash
# Install all project dependencies
npm run install:all

# Install test-specific dependencies
cd tests
npm install
```

### 2. Install Bitcoin Core

#### Ubuntu/Debian

```bash
sudo apt-get update
sudo add-apt-repository ppa:bitcoin/bitcoin
sudo apt-get install bitcoind bitcoin-cli
```

#### macOS

```bash
brew install bitcoin
```

#### Windows (WSL2)

```bash
# Follow Ubuntu instructions in WSL2
```

### 3. Verify Installation

```bash
# Check Bitcoin Core installation
bitcoind --version
bitcoin-cli --version

# Check Node.js and npm
node --version
npm --version
```

## Quick Start

### Run All Tests

```bash
npm run test:bitcoin
```

### Run Specific Test Categories

```bash
# Unit tests only
npm run test:bitcoin:unit

# Integration tests
npm run test:bitcoin:integration  

# Security tests
npm run test:bitcoin:security

# Performance tests
npm run test:bitcoin:performance

# Coverage report
npm run test:bitcoin:coverage
```

## Test Categories

### 🔧 Unit Tests (`tests/bitcoin/`)

Tests individual Bitcoin HTLC components in isolation.

**Features Tested:**

- HTLC script creation and validation
- Transaction construction (funding, redemption, refund)
- Secret generation and verification
- Address derivation and validation

**Run Tests:**

```bash
npm run test:bitcoin:unit
```

**Coverage:** Bitcoin Core functions, HTLC scripts, transaction building

### 🔗 Integration Tests (`tests/integration/`)

End-to-end testing of cross-chain atomic swaps.

**Features Tested:**

- Complete ETH ↔ BTC swap flows
- Cross-chain secret coordination
- Timeout and refund scenarios
- Multi-step transaction coordination

**Run Tests:**

```bash
npm run test:bitcoin:integration
```

**Requirements:** Bitcoin regtest + Ethereum Hardhat network

### 🔒 Security Tests (`tests/bitcoin/security.test.ts`)

Validation of security properties and attack resistance.

**Features Tested:**

- Invalid secret rejection
- Timelock enforcement
- Double-spending prevention
- Script manipulation resistance
- Cryptographic security

**Run Tests:**

```bash
npm run test:bitcoin:security
```

**Coverage:** Attack vectors, edge cases, input validation

### ⚡ Performance Tests (`tests/performance/`)

Load testing and performance benchmarking.

**Features Tested:**

- HTLC creation throughput
- Transaction processing speed
- Concurrent operation handling
- Memory usage optimization

**Run Tests:**

```bash
npm run test:bitcoin:performance
```

**Metrics:** Operations/second, latency, memory usage, concurrency

## Docker Environment

### Quick Start with Docker

```bash
cd tests

# Start test environment
docker-compose up -d

# Run comprehensive test suite
docker-compose up --build test-coordinator

# View logs
docker-compose logs -f

# Stop environment
docker-compose down -v
```

### Services

- **bitcoin-regtest**: Bitcoin Core regtest node
- **hardhat-node**: Ethereum development network
- **test-runner**: Interactive test environment
- **test-coordinator**: Automated test execution

### Docker Commands

```bash
# Build and start all services
npm run docker:up

# Run full test suite
npm run docker:test

# View service logs
npm run docker:logs

# Clean up environment
npm run docker:down
```

## Configuration

### Environment Variables

```bash
# Bitcoin Configuration
BITCOIN_REGTEST_HOST=localhost
BITCOIN_REGTEST_PORT=18443
BITCOIN_REGTEST_USER=test
BITCOIN_REGTEST_PASS=test

# Ethereum Configuration  
ETH_RPC_URL=http://localhost:8545
ETH_CHAIN_ID=31337

# Test Configuration
NODE_ENV=test
TEST_TIMEOUT=60000
```

### Jest Configuration (`jest.config.js`)

```javascript
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testTimeout: 60000,
  maxWorkers: 2,
  setupFilesAfterEnv: ['<rootDir>/setup/jest-setup.ts']
};
```

## CI/CD Integration

### GitHub Actions

Automated testing pipeline with multiple jobs:

- **Unit Tests**: Fast validation on multiple Node.js versions
- **Integration Tests**: Full cross-chain testing
- **Security Audit**: Security validation and dependency checking
- **Performance Tests**: Benchmarking and load testing
- **Coverage Report**: Code coverage analysis

### Workflow Triggers

```yaml
# Automatic triggers
on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
```

### Manual Performance Testing

```bash
# Trigger performance tests
git commit -m "Update HTLC logic [perf-test]"
git push
```

## Development Workflow

### 1. Setup Development Environment

```bash
# Clone and install
git clone <repository>
cd tests
npm install

# Verify setup
npm run test:bitcoin:unit
```

### 2. Writing Tests

```javascript
// Example test structure
describe('Bitcoin HTLC Feature', () => {
  let testSetup;
  
  beforeAll(async () => {
    testSetup = await setupTestEnvironment();
  });
  
  afterAll(async () => {
    await testSetup.cleanup();
  });
  
  test('should validate HTLC functionality', async () => {
    // Test implementation
  });
});
```

### 3. Running Tests During Development

```bash
# Watch mode for development
npm run test:watch

# Run specific test files
npm test -- --testNamePattern="HTLC creation"

# Debug mode
npm test -- --runInBand --no-cache
```

### 4. Code Coverage

```bash
# Generate coverage report
npm run test:coverage

# View coverage report
open coverage/lcov-report/index.html
```

## Test Reports

### Generate Reports

```bash
# Generate all reports
npm run generate:reports

# Generate performance reports only
npm run generate:performance-report
```

### Report Types

- **HTML Dashboard**: Interactive test results (`reports/index.html`)
- **Coverage Report**: Line and branch coverage (`reports/coverage/`)
- **Performance Report**: Benchmarks and metrics (`reports/performance/`)
- **Markdown Summary**: Text-based summary (`reports/test-summary.md`)

## Troubleshooting

### Common Issues

**Bitcoin Core Not Found**

```bash
# Install Bitcoin Core
sudo apt-get install bitcoind bitcoin-cli

# Verify installation
which bitcoind
```

**Port Conflicts**

```bash
# Check port usage
lsof -i :18443
lsof -i :8545

# Kill conflicting processes
pkill -f bitcoind
```

**Memory Issues**

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run test:performance
```

**Docker Issues**

```bash
# Clean Docker environment
docker-compose down -v
docker system prune -f

# Rebuild containers
docker-compose up --build
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=bitcoin:* npm run test:bitcoin:unit

# Run single test with debugging
npm test -- --testNamePattern="specific test" --verbose
```

### Getting Help

1. **Check Logs**: Review test output and error messages
2. **Verify Setup**: Ensure Bitcoin Core and dependencies are installed
3. **Clean Environment**: Remove cached data and restart services
4. **Check Documentation**: Review this README and inline code comments

## Performance Benchmarks

### Target Metrics

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| HTLC Creation | >1000 ops/sec | <500 ops/sec | <100 ops/sec |
| Transaction Building | >100 tx/sec | <50 tx/sec | <10 tx/sec |
| Memory Usage | <200 MB | <400 MB | <800 MB |
| Test Success Rate | >95% | <90% | <80% |

### Optimization Tips

1. **Use Connection Pooling** for database operations
2. **Implement Caching** for frequently accessed data
3. **Optimize Memory Usage** with garbage collection
4. **Use Async Patterns** for non-blocking operations
5. **Monitor Resource Usage** with alerts

## Contributing

### Adding Tests

1. **Create Test File**: Follow naming convention `*.test.ts`
2. **Use Test Utilities**: Leverage existing setup functions
3. **Add Documentation**: Document test purpose and requirements
4. **Update CI/CD**: Ensure tests run in automation

### Test Standards

- ✅ **Descriptive Names**: Clear test descriptions
- ✅ **Proper Setup/Teardown**: Clean test environment
- ✅ **Error Handling**: Test both success and failure cases
- ✅ **Performance Considerations**: Avoid slow operations
- ✅ **Documentation**: Comment complex test logic

## License

MIT License - See LICENSE file for details.

---

## Support

For questions and support:

1. **Documentation**: Check this README and inline comments
2. **Issues**: Create GitHub issues for bugs and feature requests  
3. **Discussions**: Use GitHub Discussions for questions

**Framework Version**: 1.0.0  
**Last Updated**: ${new Date().toISOString().split['T'](0)}  
**Maintained By**: 1inch Fusion+ Development Team
