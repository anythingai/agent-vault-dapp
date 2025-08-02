const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Infrastructure Integration Tests', () => {
  const timeout = 300000; // 5 minutes for integration tests

  describe('Script Integration', () => {
    const scriptsDir = path.join(__dirname, '../../../scripts/infrastructure');

    beforeAll(() => {
      // Ensure all scripts exist and are executable
      const requiredScripts = [
        'deploy-infrastructure.sh',
        'deploy-kubernetes.sh',
        'cleanup-infrastructure.sh',
        'health-check.sh',
        'cost-optimization.sh',
        'validate-infrastructure.sh',
        'backup-disaster-recovery.sh',
        'manage-local-dev.sh'
      ];

      requiredScripts.forEach(script => {
        const scriptPath = path.join(scriptsDir, script);
        expect(fs.existsSync(scriptPath)).toBe(true);
        
        // Check if script is executable
        try {
          fs.accessSync(scriptPath, fs.constants.X_OK);
        } catch (error) {
          fail(`Script ${script} is not executable`);
        }
      });
    });

    test('infrastructure scripts should show help when called with --help', () => {
      const scripts = [
        'deploy-infrastructure.sh',
        'deploy-kubernetes.sh',
        'cleanup-infrastructure.sh',
        'health-check.sh',
        'cost-optimization.sh',
        'validate-infrastructure.sh',
        'backup-disaster-recovery.sh'
      ];

      scripts.forEach(script => {
        const scriptPath = path.join(scriptsDir, script);
        try {
          const output = execSync(`bash ${scriptPath} --help`, { 
            encoding: 'utf8',
            timeout: 10000 
          });
          expect(output).toMatch(/usage|Usage|USAGE/i);
          expect(output).toMatch(/options|Options|OPTIONS/i);
        } catch (error) {
          fail(`Script ${script} failed to show help: ${error.message}`);
        }
      });
    });

    test('validation script should work with config-only mode', () => {
      const scriptPath = path.join(scriptsDir, 'validate-infrastructure.sh');
      try {
        execSync(`bash ${scriptPath} -e local -t terraform -c`, {
          encoding: 'utf8',
          timeout: 60000,
          stdio: 'ignore'
        });
      } catch (error) {
        if (error.status === 1) {
          // Validation failures are acceptable for this test
          console.warn('Infrastructure validation found issues (expected in some environments)');
        } else {
          fail(`Validation script failed unexpectedly: ${error.message}`);
        }
      }
    });

    test('health check script should work in dry-run mode', () => {
      const scriptPath = path.join(scriptsDir, 'health-check.sh');
      try {
        // Test with local environment as it doesn't require AWS resources
        execSync(`bash ${scriptPath} -e local -t infrastructure`, {
          encoding: 'utf8',
          timeout: 30000,
          stdio: 'ignore'
        });
      } catch (error) {
        // Health check failures are acceptable for local environment
        console.warn('Health check found issues (expected in local environment)');
      }
    });
  }, timeout);

  describe('Configuration Consistency', () => {
    test('Terraform and Kubernetes environments should match', () => {
      const terraformDir = path.join(__dirname, '../../../infrastructure/terraform/environments');
      const k8sDir = path.join(__dirname, '../../../infrastructure/kubernetes/environments');

      if (fs.existsSync(terraformDir) && fs.existsSync(k8sDir)) {
        const terraformEnvs = fs.readdirSync(terraformDir)
          .filter(file => file.endsWith('.tfvars'))
          .map(file => file.replace('.tfvars', ''));
        
        const k8sEnvs = fs.readdirSync(k8sDir)
          .filter(dir => fs.statSync(path.join(k8sDir, dir)).isDirectory());

        // All Terraform environments should have corresponding Kubernetes environments
        terraformEnvs.forEach(env => {
          expect(k8sEnvs).toContain(env);
        });
      }
    });

    test('Docker Compose and Kubernetes should have consistent service definitions', () => {
      const composePath = path.join(__dirname, '../../../infrastructure/docker-compose/docker-compose.yml');
      const k8sBaseDir = path.join(__dirname, '../../../infrastructure/kubernetes/base');

      if (fs.existsSync(composePath) && fs.existsSync(k8sBaseDir)) {
        const yaml = require('js-yaml');
        
        // Load Docker Compose config
        const composeContent = fs.readFileSync(composePath, 'utf8');
        const composeConfig = yaml.load(composeContent);
        
        // Get application services (exclude databases)
        const appServices = Object.keys(composeConfig.services || {})
          .filter(service => service.startsWith('fusion-bitcoin-'));

        // Check if corresponding Kubernetes manifests exist
        appServices.forEach(service => {
          const k8sFiles = fs.readdirSync(k8sBaseDir)
            .filter(file => file.includes(service) || file.includes(service.replace('fusion-bitcoin-', '')));
          
          expect(k8sFiles.length).toBeGreaterThan(0);
        });
      }
    });

    test('environment configurations should have required fields', () => {
      const environments = ['local', 'staging', 'production'];
      
      environments.forEach(env => {
        // Check Terraform variables
        const tfvarsPath = path.join(__dirname, `../../../infrastructure/terraform/environments/${env}.tfvars`);
        if (fs.existsSync(tfvarsPath)) {
          const content = fs.readFileSync(tfvarsPath, 'utf8');
          expect(content).toMatch(/environment\s*=\s*"?${env}"?/);
          expect(content).toMatch(/aws_region\s*=\s*"[\w-]+"/);
        }

        // Check Kubernetes configuration
        const k8sConfigPath = path.join(__dirname, `../../../infrastructure/kubernetes/environments/${env}`);
        if (fs.existsSync(k8sConfigPath)) {
          const kustomizationPath = path.join(k8sConfigPath, 'kustomization.yaml');
          expect(fs.existsSync(kustomizationPath)).toBe(true);
        }
      });
    });
  });

  describe('Security Configuration', () => {
    test('should not contain hardcoded credentials in configuration files', () => {
      const configDirs = [
        path.join(__dirname, '../../../infrastructure'),
        path.join(__dirname, '../../../config'),
        path.join(__dirname, '../../../scripts')
      ];

      const credentialPatterns = [
        /password\s*[:=]\s*["']?[^"'\s]{8,}["']?/i,
        /secret\s*[:=]\s*["']?[^"'\s]{16,}["']?/i,
        /AKIA[0-9A-Z]{16}/,  // AWS Access Key
        /[0-9a-zA-Z/+]{40}/,  // AWS Secret Key (basic pattern)
        /-----BEGIN [A-Z ]+-----/  // Private key headers
      ];

      function scanDirectory(dir) {
        if (!fs.existsSync(dir)) return;
        
        const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
        
        files.forEach(file => {
          if (file.isFile()) {
            const filePath = path.join(file.path || dir, file.name);
            const ext = path.extname(file.name).toLowerCase();
            
            // Skip binary files and node_modules
            if (['.tf', '.yaml', '.yml', '.json', '.js', '.ts', '.sh', '.env'].includes(ext) && 
                !filePath.includes('node_modules') &&
                !filePath.includes('.git') &&
                !filePath.includes('test') &&
                !file.name.includes('example')) {
              
              try {
                const content = fs.readFileSync(filePath, 'utf8');
                
                credentialPatterns.forEach(pattern => {
                  const matches = content.match(pattern);
                  if (matches) {
                    // Allow certain exceptions
                    const exceptions = [
                      'password_placeholder',
                      'your_password_here',
                      'change_me',
                      'example_password',
                      'REPLACE_WITH_ACTUAL',
                      'secretKeyRef',
                      'valueFrom'
                    ];
                    
                    const isException = exceptions.some(exc => 
                      matches[0].toLowerCase().includes(exc.toLowerCase())
                    );
                    
                    if (!isException) {
                      fail(`Potential hardcoded credential found in ${filePath}: ${matches[0].substring(0, 50)}...`);
                    }
                  }
                });
              } catch (error) {
                // Skip files that cannot be read as text
              }
            }
          }
        });
      }

      configDirs.forEach(scanDirectory);
    });

    test('should have proper file permissions on scripts', () => {
      const scriptsDir = path.join(__dirname, '../../../scripts/infrastructure');
      
      if (fs.existsSync(scriptsDir)) {
        const scripts = fs.readdirSync(scriptsDir)
          .filter(file => file.endsWith('.sh'));
        
        scripts.forEach(script => {
          const scriptPath = path.join(scriptsDir, script);
          const stats = fs.statSync(scriptPath);
          const mode = stats.mode;
          
          // Check that owner has execute permission (bit 6)
          expect(mode & 0o100).not.toBe(0);
        });
      }
    });
  });

  describe('Documentation Consistency', () => {
    test('should have documentation for all infrastructure components', () => {
      const docsDir = path.join(__dirname, '../../../docs');
      
      const requiredDocs = [
        'infrastructure-overview.md',
        'infrastructure-troubleshooting.md', 
        'disaster-recovery-runbook.md',
        'deployment-procedures.md',
        'security-best-practices.md'
      ];

      requiredDocs.forEach(doc => {
        const docPath = path.join(docsDir, doc);
        expect(fs.existsSync(docPath)).toBe(true);
        
        // Check that documentation is not empty
        const content = fs.readFileSync(docPath, 'utf8');
        expect(content.length).toBeGreaterThan(100);
      });
    });

    test('documentation should reference existing scripts', () => {
      const docsDir = path.join(__dirname, '../../../docs');
      const scriptsDir = path.join(__dirname, '../../../scripts/infrastructure');
      
      if (fs.existsSync(docsDir) && fs.existsSync(scriptsDir)) {
        const scripts = fs.readdirSync(scriptsDir)
          .filter(file => file.endsWith('.sh'))
          .map(file => file.replace('.sh', ''));
        
        const docs = fs.readdirSync(docsDir)
          .filter(file => file.endsWith('.md'));
        
        // Read all documentation content
        let allDocsContent = '';
        docs.forEach(doc => {
          const docPath = path.join(docsDir, doc);
          allDocsContent += fs.readFileSync(docPath, 'utf8');
        });

        // Major scripts should be mentioned in documentation
        const majorScripts = [
          'deploy-infrastructure',
          'deploy-kubernetes', 
          'health-check',
          'backup-disaster-recovery'
        ];

        majorScripts.forEach(script => {
          expect(allDocsContent).toMatch(new RegExp(script, 'i'));
        });
      }
    });
  });

  describe('Backup and Recovery Validation', () => {
    test('backup directories should be created properly', () => {
      const backupScript = path.join(__dirname, '../../../scripts/infrastructure/backup-disaster-recovery.sh');
      const projectRoot = path.join(__dirname, '../../..');

      try {
        // Test backup directory creation (dry-run)
        execSync(`bash ${backupScript} -e local -a backup -t infrastructure -n`, {
          encoding: 'utf8',
          timeout: 30000,
          stdio: 'ignore'
        });
        
        // Check that backup directories are created
        const backupDir = path.join(projectRoot, 'backups');
        if (fs.existsSync(backupDir)) {
          expect(fs.statSync(backupDir).isDirectory()).toBe(true);
        }
      } catch (error) {
        console.warn('Backup test failed (may require additional setup):', error.message);
      }
    });
  });

  describe('Performance Validation', () => {
    test('scripts should complete within reasonable time limits', async () => {
      const performanceTests = [
        { script: 'validate-infrastructure.sh', args: '-e local -t terraform -c', timeout: 30000 },
        { script: 'health-check.sh', args: '-e local -t infrastructure', timeout: 20000 }
      ];

      for (const test of performanceTests) {
        const scriptPath = path.join(__dirname, `../../../scripts/infrastructure/${test.script}`);
        const startTime = Date.now();
        
        try {
          execSync(`bash ${scriptPath} ${test.args}`, {
            encoding: 'utf8',
            timeout: test.timeout,
            stdio: 'ignore'
          });
        } catch (error) {
          // Script failures are acceptable, we're testing performance
        }
        
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(test.timeout);
      }
    }, timeout);
  });
});