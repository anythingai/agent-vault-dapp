const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Terraform Infrastructure Tests', () => {
  const terraformDir = path.join(__dirname, '../../../infrastructure/terraform');
  const environments = ['local', 'staging', 'production'];
  
  beforeAll(() => {
    // Ensure terraform is available
    try {
      execSync('terraform version', { stdio: 'ignore' });
    } catch (error) {
      throw new Error('Terraform is not installed or not in PATH');
    }
  });

  describe('Terraform Configuration Validation', () => {
    beforeEach(() => {
      process.chdir(terraformDir);
    });

    test('should validate terraform syntax', () => {
      const result = execSync('terraform validate -json', { encoding: 'utf8' });
      const validation = JSON.parse(result);
      
      expect(validation.valid).toBe(true);
      expect(validation.error_count).toBe(0);
    });

    test('should have proper formatting', () => {
      try {
        execSync('terraform fmt -check -recursive', { stdio: 'ignore' });
      } catch (error) {
        fail('Terraform files are not properly formatted. Run: terraform fmt -recursive');
      }
    });

    test('should initialize successfully', () => {
      try {
        execSync('terraform init -backend=false', { stdio: 'ignore' });
      } catch (error) {
        fail('Terraform initialization failed');
      }
    });
  });

  describe('Environment-Specific Validation', () => {
    environments.forEach(env => {
      describe(`${env} environment`, () => {
        const tfvarsFile = `environments/${env}.tfvars`;
        
        test(`should have ${env}.tfvars file`, () => {
          const tfvarsPath = path.join(terraformDir, tfvarsFile);
          expect(fs.existsSync(tfvarsPath)).toBe(true);
        });

        test(`should validate with ${env} variables`, () => {
          if (env === 'local') {
            // Skip terraform plan for local as it doesn't require AWS resources
            return;
          }

          try {
            const result = execSync(
              `terraform plan -var-file=${tfvarsFile} -detailed-exitcode`,
              { encoding: 'utf8', cwd: terraformDir }
            );
            // Exit code 0 = no changes, 2 = changes detected, both are valid
          } catch (error) {
            if (error.status === 1) {
              fail(`Terraform plan failed for ${env} environment`);
            }
            // Status 2 means changes detected, which is acceptable for tests
          }
        });
      });
    });
  });

  describe('Required Files', () => {
    const requiredFiles = [
      'main.tf',
      'variables.tf',
      'outputs.tf',
      'vpc.tf',
      'eks.tf',
      'rds.tf',
      'redis.tf',
      'security.tf',
      'monitoring.tf'
    ];

    requiredFiles.forEach(file => {
      test(`should have ${file}`, () => {
        const filePath = path.join(terraformDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
      });
    });
  });

  describe('Security Configuration', () => {
    test('should not contain hardcoded credentials', () => {
      const files = fs.readdirSync(terraformDir, { recursive: true })
        .filter(file => file.endsWith('.tf'))
        .map(file => path.join(terraformDir, file));

      const suspiciousPatterns = [
        /password\s*=\s*"[^"]+"/i,
        /secret\s*=\s*"[^"]+"/i,
        /AKIA[0-9A-Z]{16}/,  // AWS Access Key pattern
        /[0-9a-zA-Z/+]{40}/   // AWS Secret Key pattern
      ];

      files.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        suspiciousPatterns.forEach(pattern => {
          expect(content).not.toMatch(pattern);
        });
      });
    });

    test('should have encrypted storage configured', () => {
      const files = ['rds.tf', 'redis.tf'];
      files.forEach(file => {
        const filePath = path.join(terraformDir, file);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          expect(content).toMatch(/encrypt/i);
        }
      });
    });
  });

  describe('Tagging Standards', () => {
    test('should have consistent resource tagging', () => {
      const tfFiles = fs.readdirSync(terraformDir)
        .filter(file => file.endsWith('.tf'))
        .map(file => path.join(terraformDir, file));

      const requiredTags = ['Project', 'Environment', 'ManagedBy'];
      
      tfFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('resource ')) {
          // Check if tags block exists
          if (content.includes('tags')) {
            requiredTags.forEach(tag => {
              expect(content).toMatch(new RegExp(`${tag}\\s*=`, 'i'));
            });
          }
        }
      });
    });
  });
});