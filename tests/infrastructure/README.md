# Infrastructure Tests - Fusion Bitcoin Bridge

This directory contains comprehensive infrastructure tests for the Fusion Bitcoin Bridge project. The tests validate Terraform configurations, Kubernetes manifests, Docker Compose setups, and overall infrastructure integrity.

## Test Structure

```
tests/infrastructure/
├── terraform/          # Terraform configuration tests
├── kubernetes/         # Kubernetes manifest tests
├── docker/            # Docker Compose tests
├── integration/       # End-to-end integration tests
├── package.json       # Test dependencies and scripts
├── jest.setup.js      # Global test setup
├── run-tests.sh       # Comprehensive test runner
└── README.md          # This file
```

## Prerequisites

### Required Tools

- **Node.js** (v16 or later)
- **npm** (v8 or later)

### Environment-Specific Tools

- **Terraform** (v1.0+) - for Terraform tests
- **kubectl** - for Kubernetes tests
- **Docker & Docker Compose** - for Docker tests
- **AWS CLI** - for integration tests (with proper credentials)

### Installation

1. Navigate to the tests directory:

   ```bash
   cd tests/infrastructure
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

## Running Tests

### Quick Start

Run all infrastructure tests:

```bash
./run-tests.sh
```

### Test Categories

#### Terraform Tests

Validates Terraform configurations, syntax, and best practices:

```bash
./run-tests.sh -t terraform
npm run test:terraform
```

**What it tests:**

- Terraform syntax validation
- Configuration formatting
- Environment-specific variables
- Security best practices
- Resource tagging standards

#### Kubernetes Tests

Validates Kubernetes manifests and configurations:

```bash
./run-tests.sh -t kubernetes
npm run test:kubernetes
```

**What it tests:**

- YAML syntax validation
- Kustomize build validation
- Resource definitions and limits
- Security contexts and RBAC
- Network policies
- ConfigMap and Secret configurations

#### Docker Compose Tests

Validates Docker Compose configurations:

```bash
./run-tests.sh -t docker
npm run test:docker
```

**What it tests:**

- Docker Compose syntax
- Service dependencies
- Port mappings
- Environment variables
- Volume configurations
- Security settings

#### Integration Tests

End-to-end infrastructure validation:

```bash
./run-tests.sh -t integration
npm run test:integration
```

**What it tests:**

- Cross-component consistency
- Script functionality
- Configuration alignment
- Security compliance
- Documentation completeness

### Advanced Usage

#### Environment-Specific Testing

```bash
./run-tests.sh -e production -t all
./run-tests.sh -e staging -t kubernetes
```

#### Coverage Reports

```bash
./run-tests.sh -c
npm run test:coverage
```

#### Watch Mode for Development

```bash
./run-tests.sh -w
npm run test:watch
```

#### CI/CD Integration

```bash
./run-tests.sh -f junit -o reports/
npm run test:ci
```

## Test Configuration

### Jest Configuration

Located in `package.json`, the Jest configuration includes:

- 5-minute timeout for infrastructure tests
- Coverage collection
- Custom test environment setup
- JUnit report generation

### Environment Variables

Tests use the following environment variables:

- `TEST_ENVIRONMENT` - Target environment (local/staging/production)
- `PROJECT_ROOT` - Project root directory
- `VERBOSE_TESTS` - Enable verbose output

## Writing Tests

### Test Structure

Each test file should follow this structure:

```javascript
describe('Component Tests', () => {
  beforeAll(() => {
    // Setup code
  });

  describe('Feature Category', () => {
    test('should validate specific requirement', () => {
      // Test implementation
    });
  });
});
```

### Helper Functions

Global helper functions are available via `global.testHelpers`:

```javascript
// Execute commands safely
global.testHelpers.execCommand('terraform validate');

// Check command availability
if (global.testHelpers.commandExists('kubectl')) {
  // Run kubectl-dependent tests
}

// Read YAML files
const config = global.testHelpers.readYaml('path/to/file.yaml');
```

### Best Practices

1. **Use descriptive test names** that explain what is being validated
2. **Group related tests** using nested `describe` blocks
3. **Handle missing tools gracefully** using `skipIfMissing` helper
4. **Test both positive and negative cases** where applicable
5. **Include environment-specific tests** for different deployment scenarios

## Test Examples

### Terraform Validation Test

```javascript
test('should validate terraform syntax', () => {
  const result = execSync('terraform validate -json', { encoding: 'utf8' });
  const validation = JSON.parse(result);
  
  expect(validation.valid).toBe(true);
  expect(validation.error_count).toBe(0);
});
```

### Kubernetes Manifest Test

```javascript
test('should have proper resource limits', () => {
  const manifests = yaml.loadAll(manifestContent);
  const deployments = manifests.filter(m => m.kind === 'Deployment');
  
  deployments.forEach(deployment => {
    const containers = deployment.spec?.template?.spec?.containers || [];
    containers.forEach(container => {
      expect(container.resources.requests).toBeDefined();
      expect(container.resources.limits).toBeDefined();
    });
  });
});
```

## Continuous Integration

### GitHub Actions Integration

Add to your workflow:

```yaml
- name: Run Infrastructure Tests
  run: |
    cd tests/infrastructure
    npm install
    ./run-tests.sh -f junit -o ${{ github.workspace }}/test-results

- name: Publish Test Results
  uses: dorny/test-reporter@v1
  if: success() || failure()
  with:
    name: Infrastructure Tests
    path: test-results/*.xml
    reporter: jest-junit
```

### Local Pre-commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
cd tests/infrastructure
npm run test:ci
```

## Troubleshooting

### Common Issues

#### "Command not found" errors

- Install missing prerequisites (terraform, kubectl, docker)
- Check PATH environment variable

#### "Permission denied" errors

- Make test runner script executable: `chmod +x run-tests.sh`
- Check file permissions on configuration files

#### AWS credential errors

- Configure AWS CLI: `aws configure`
- For CI/CD, use environment variables or IAM roles

#### Timeout errors

- Increase Jest timeout in `package.json`
- Use `-s` flag to skip prerequisite checks for faster runs

### Debug Mode

Enable verbose output for debugging:

```bash
./run-tests.sh -v -t integration
```

### Test-Specific Debugging

#### Terraform Tests

```bash
cd ../infrastructure/terraform
terraform validate
terraform fmt -check
```

#### Kubernetes Tests

```bash
cd ../infrastructure/kubernetes/environments/local
kubectl kustomize . | kubectl apply --dry-run=client -f -
```

#### Docker Tests

```bash
cd ../infrastructure/docker-compose
docker-compose config --quiet
```

## Contributing

### Adding New Tests

1. Create test files in the appropriate category directory
2. Follow the existing naming convention (`*.test.js`)
3. Include both positive and negative test cases
4. Update this README if adding new test categories

### Test Coverage Goals

- **Terraform**: 100% configuration file coverage
- **Kubernetes**: All manifest validation and security checks
- **Docker**: Complete service and security configuration coverage
- **Integration**: End-to-end workflow validation

### Review Checklist

- [ ] Tests pass locally
- [ ] Tests include error handling
- [ ] Documentation is updated
- [ ] Tests work across all target environments
- [ ] Security validations are included

## Support

For issues with infrastructure tests:

1. Check the troubleshooting section
2. Review test logs in `reports/` directory
3. Validate prerequisites are installed
4. Check project documentation in `docs/`

For questions about specific infrastructure components:

- **Terraform**: See `docs/infrastructure-overview.md`
- **Kubernetes**: See `docs/deployment-procedures.md`
- **Docker**: See `infrastructure/docker-compose/README.md`
- **General**: See `docs/infrastructure-troubleshooting.md`
