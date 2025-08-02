#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Generate comprehensive test reports
 */
async function generateReports() {
  console.log('🎯 Generating comprehensive test reports...');
  
  const reportsDir = path.join(__dirname, '..', 'reports');
  const coverageDir = path.join(__dirname, '..', 'coverage');
  
  // Ensure reports directory exists
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  try {
    // Generate HTML report index
    await generateHTMLIndex();
    
    // Generate markdown summary
    await generateMarkdownSummary();
    
    // Copy coverage reports
    await copyCoverageReports();
    
    console.log('✅ Test reports generated successfully!');
    console.log(`📊 Reports available at: ${reportsDir}`);
    
  } catch (error) {
    console.error('❌ Error generating reports:', error);
    process.exit(1);
  }
}

async function generateHTMLIndex() {
  const reportsDir = path.join(__dirname, '..', 'reports');
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bitcoin HTLC Test Reports</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            text-align: center;
            margin-bottom: 30px;
        }
        .report-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .report-card {
            background: white;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            transition: transform 0.2s;
        }
        .report-card:hover {
            transform: translateY(-2px);
        }
        .report-card h3 {
            margin-top: 0;
            color: #667eea;
        }
        .report-link {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 10px;
        }
        .report-link:hover {
            background: #5a67d8;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 30px;
        }
        .stat-item {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
            margin-top: 20px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Bitcoin HTLC Testing Framework</h1>
        <p>Comprehensive test results for 1inch Fusion+ Cross-Chain Swap Extension</p>
    </div>

    <div class="report-grid">
        <div class="report-card">
            <h3>📊 Test Coverage</h3>
            <p>Code coverage analysis for Bitcoin HTLC implementation</p>
            <a href="./coverage/lcov-report/index.html" class="report-link">View Coverage Report</a>
        </div>

        <div class="report-card">
            <h3>🔧 Unit Tests</h3>
            <p>Bitcoin HTLC script creation and validation tests</p>
            <a href="./unit-test-results.html" class="report-link">View Unit Tests</a>
        </div>

        <div class="report-card">
            <h3>🔗 Integration Tests</h3>
            <p>Cross-chain atomic swap end-to-end testing</p>
            <a href="./integration-test-results.html" class="report-link">View Integration Tests</a>
        </div>

        <div class="report-card">
            <h3>🔒 Security Tests</h3>
            <p>Security validation and attack resistance testing</p>
            <a href="./security-test-results.html" class="report-link">View Security Tests</a>
        </div>

        <div class="report-card">
            <h3>⚡ Performance Tests</h3>
            <p>Load testing and performance benchmarks</p>
            <a href="./performance-test-results.html" class="report-link">View Performance Tests</a>
        </div>

        <div class="report-card">
            <h3>🎯 Test Summary</h3>
            <p>Overall test execution summary and metrics</p>
            <a href="./test-summary.md" class="report-link">View Summary</a>
        </div>
    </div>

    <div class="stats">
        <div class="stat-item">
            <div class="stat-value" id="total-tests">-</div>
            <div>Total Tests</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="passed-tests">-</div>
            <div>Passed</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="coverage-percent">-</div>
            <div>Coverage</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="execution-time">-</div>
            <div>Execution Time</div>
        </div>
    </div>

    <div class="timestamp">
        Generated on ${new Date().toLocaleString()}
    </div>

    <script>
        // Load test statistics if available
        fetch('./test-stats.json')
            .then(response => response.json())
            .then(data => {
                document.getElementById('total-tests').textContent = data.totalTests || '-';
                document.getElementById('passed-tests').textContent = data.passedTests || '-';
                document.getElementById('coverage-percent').textContent = (data.coverage || 0) + '%';
                document.getElementById('execution-time').textContent = (data.executionTime || 0) + 's';
            })
            .catch(() => {
                console.log('Test statistics not available');
            });
    </script>
</body>
</html>
  `.trim();
  
  fs.writeFileSync(path.join(reportsDir, 'index.html'), htmlContent);
}

async function generateMarkdownSummary() {
  const reportsDir = path.join(__dirname, '..', 'reports');
  const summaryContent = `
# Bitcoin HTLC Testing Framework - Test Summary

## Overview

This document provides a comprehensive summary of the Bitcoin HTLC testing framework for the 1inch Fusion+ Cross-Chain Swap Extension.

## Test Categories

### 🔧 Unit Tests
- **Location**: \`tests/bitcoin/\`
- **Purpose**: Test individual HTLC components
- **Coverage**: Script creation, validation, transaction construction
- **Files**:
  - \`htlc.test.ts\` - HTLC script testing
  - \`transactions.test.ts\` - Transaction construction
  - \`security.test.ts\` - Security validation

### 🔗 Integration Tests
- **Location**: \`tests/integration/\`
- **Purpose**: End-to-end cross-chain swap testing
- **Coverage**: Complete atomic swap flows
- **Files**:
  - \`setup.ts\` - Cross-chain environment setup
  - \`atomicSwap.test.ts\` - Full swap testing

### ⚡ Performance Tests
- **Location**: \`tests/performance/\`
- **Purpose**: Load testing and benchmarking
- **Coverage**: Concurrent operations, memory usage
- **Files**:
  - \`load.test.ts\` - Performance benchmarks

## Infrastructure

### Bitcoin Regtest Setup
- **Automated regtest node management**
- **Test wallet creation and funding**
- **Block generation utilities**
- **Transaction monitoring**

### Cross-Chain Environment
- **Bitcoin regtest integration**
- **Ethereum Hardhat network**
- **Docker containerization**
- **CI/CD automation**

## Running Tests

### Local Development
\`\`\`bash
# Install dependencies
npm run install:all

# Run all Bitcoin tests
npm run test:bitcoin

# Run specific test categories
npm run test:bitcoin:unit
npm run test:bitcoin:integration
npm run test:bitcoin:security
npm run test:bitcoin:performance

# Generate coverage report
npm run test:bitcoin:coverage
\`\`\`

### Docker Environment
\`\`\`bash
# Start test environment
cd tests
npm run docker:up

# Run comprehensive test suite
npm run docker:test

# View logs
npm run docker:logs

# Clean up
npm run docker:down
\`\`\`

### CI/CD Pipeline
- **GitHub Actions integration**
- **Multi-node version testing**
- **Automated Bitcoin Core installation**
- **Test result artifacts**
- **Coverage reporting**

## Key Features

### ✅ Comprehensive Coverage
- HTLC script creation and validation
- Funding, redemption, and refund transactions
- Security attack resistance
- Cross-chain coordination
- Performance benchmarking

### ✅ Realistic Testing Environment
- Bitcoin regtest for fast iteration
- Ethereum Hardhat for smart contracts
- Docker containerization
- CI/CD automation

### ✅ Security Focus
- Invalid secret rejection
- Timelock enforcement
- Double-spending prevention
- Script manipulation resistance

### ✅ Performance Validation
- Concurrent operation handling
- Memory usage monitoring
- Transaction throughput testing
- Load balancing verification

## Test Data and Utilities

### Test Wallets
- Deterministic key generation
- Automated funding
- Address monitoring
- UTXO management

### Utilities
- Block mining automation
- Transaction confirmation waiting
- Cross-chain synchronization
- Error simulation

## Metrics and Reporting

### Coverage Metrics
- Line coverage
- Branch coverage
- Function coverage
- Statement coverage

### Performance Metrics
- Operations per second
- Memory usage
- Latency measurements
- Concurrent load handling

### Security Metrics
- Attack resistance validation
- Input sanitization testing
- Error handling verification
- Edge case coverage

## Maintenance

### Regular Updates
- Bitcoin Core version updates
- Dependency security updates
- Test case expansion
- Performance optimization

### Monitoring
- CI/CD pipeline health
- Test execution times
- Failure rate tracking
- Coverage regression detection

---

**Generated**: ${new Date().toISOString()}
**Framework Version**: 1.0.0
**Bitcoin Core**: regtest
**Node.js**: ${process.version}
  `.trim();
  
  fs.writeFileSync(path.join(reportsDir, 'test-summary.md'), summaryContent);
}

async function copyCoverageReports() {
  const coverageDir = path.join(__dirname, '..', 'coverage');
  const reportsDir = path.join(__dirname, '..', 'reports', 'coverage');
  
  if (fs.existsSync(coverageDir)) {
    // Create reports coverage directory
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    // Copy coverage files
    try {
      fs.cpSync(coverageDir, reportsDir, { recursive: true });
      console.log('📊 Coverage reports copied successfully');
    } catch (error) {
      console.warn('⚠️  Could not copy coverage reports:', error.message);
    }
  }
}

// Run if called directly
if (require.main === module) {
  generateReports();
}

module.exports = { generateReports };