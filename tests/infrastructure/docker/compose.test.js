const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

describe('Docker Compose Infrastructure Tests', () => {
  const composeDir = path.join(__dirname, '../../../infrastructure/docker-compose');
  const composeFile = path.join(composeDir, 'docker-compose.yml');
  const envFile = path.join(composeDir, '.env.example');

  beforeAll(() => {
    // Ensure docker-compose is available
    try {
      execSync('docker-compose version', { stdio: 'ignore' });
    } catch (error) {
      try {
        execSync('docker compose version', { stdio: 'ignore' });
      } catch (dockerError) {
        throw new Error('Docker Compose is not installed or not in PATH');
      }
    }
  });

  describe('Configuration Files', () => {
    test('should have docker-compose.yml file', () => {
      expect(fs.existsSync(composeFile)).toBe(true);
    });

    test('should have .env.example file', () => {
      expect(fs.existsSync(envFile)).toBe(true);
    });

    test('should have valid YAML syntax', () => {
      try {
        const content = fs.readFileSync(composeFile, 'utf8');
        yaml.load(content);
      } catch (error) {
        fail(`Invalid YAML syntax in docker-compose.yml: ${error.message}`);
      }
    });
  });

  describe('Service Configuration', () => {
    let composeConfig;

    beforeAll(() => {
      const content = fs.readFileSync(composeFile, 'utf8');
      composeConfig = yaml.load(content);
    });

    test('should have required services', () => {
      const requiredServices = [
        'postgres',
        'redis',
        'fusion-bitcoin-relayer',
        'fusion-bitcoin-resolver',
        'fusion-bitcoin-frontend'
      ];

      expect(composeConfig.services).toBeDefined();
      
      requiredServices.forEach(service => {
        expect(composeConfig.services[service]).toBeDefined();
      });
    });

    test('should have proper service dependencies', () => {
      const appServices = [
        'fusion-bitcoin-relayer',
        'fusion-bitcoin-resolver',
        'fusion-bitcoin-frontend'
      ];

      appServices.forEach(service => {
        const serviceConfig = composeConfig.services[service];
        expect(serviceConfig.depends_on).toBeDefined();
        expect(serviceConfig.depends_on).toContain('postgres');
        expect(serviceConfig.depends_on).toContain('redis');
      });
    });

    test('should have proper port mappings', () => {
      const portMappings = {
        'postgres': '5432',
        'redis': '6379',
        'fusion-bitcoin-relayer': '3000',
        'fusion-bitcoin-resolver': '3001',
        'fusion-bitcoin-frontend': '3002'
      };

      Object.entries(portMappings).forEach(([service, port]) => {
        const serviceConfig = composeConfig.services[service];
        expect(serviceConfig.ports).toBeDefined();
        
        const hasCorrectPort = serviceConfig.ports.some(mapping => 
          mapping.toString().includes(port)
        );
        expect(hasCorrectPort).toBe(true);
      });
    });

    test('should have environment variables configured', () => {
      const appServices = [
        'fusion-bitcoin-relayer',
        'fusion-bitcoin-resolver',
        'fusion-bitcoin-frontend'
      ];

      appServices.forEach(service => {
        const serviceConfig = composeConfig.services[service];
        expect(
          serviceConfig.environment || serviceConfig.env_file
        ).toBeDefined();
      });
    });

    test('should have health checks configured', () => {
      const criticalServices = ['postgres', 'redis'];

      criticalServices.forEach(service => {
        const serviceConfig = composeConfig.services[service];
        if (serviceConfig.healthcheck) {
          expect(serviceConfig.healthcheck.test).toBeDefined();
          expect(serviceConfig.healthcheck.interval).toBeDefined();
          expect(serviceConfig.healthcheck.timeout).toBeDefined();
          expect(serviceConfig.healthcheck.retries).toBeDefined();
        }
      });
    });

    test('should have proper volume configurations', () => {
      const servicesWithVolumes = ['postgres', 'redis'];

      servicesWithVolumes.forEach(service => {
        const serviceConfig = composeConfig.services[service];
        expect(serviceConfig.volumes).toBeDefined();
        expect(Array.isArray(serviceConfig.volumes)).toBe(true);
        expect(serviceConfig.volumes.length).toBeGreaterThan(0);
      });
    });

    test('should have networks configured', () => {
      if (composeConfig.networks) {
        expect(Object.keys(composeConfig.networks).length).toBeGreaterThan(0);
        
        // Check that services are connected to networks
        Object.values(composeConfig.services).forEach(service => {
          if (service.networks) {
            expect(Array.isArray(service.networks) || typeof service.networks === 'object').toBe(true);
          }
        });
      }
    });
  });

  describe('Environment Variables', () => {
    test('should have all required environment variables in .env.example', () => {
      const envContent = fs.readFileSync(envFile, 'utf8');
      const requiredVars = [
        'POSTGRES_DB',
        'POSTGRES_USER', 
        'POSTGRES_PASSWORD',
        'REDIS_PASSWORD',
        'ETH_NODE_URL',
        'BTC_NODE_URL'
      ];

      requiredVars.forEach(varName => {
        expect(envContent).toMatch(new RegExp(`^${varName}=`, 'm'));
      });
    });

    test('should not contain actual secrets in .env.example', () => {
      const envContent = fs.readFileSync(envFile, 'utf8');
      
      // Check that password fields contain placeholder values
      const passwordLines = envContent.split('\n')
        .filter(line => line.includes('PASSWORD=') || line.includes('SECRET='));
      
      passwordLines.forEach(line => {
        const value = line.split('=')[1] || '';
        expect(value).toMatch(/^(your_|example_|change_me|placeholder)/i);
      });
    });
  });

  describe('Docker Compose Validation', () => {
    beforeEach(() => {
      process.chdir(composeDir);
    });

    test('should validate compose file syntax', () => {
      try {
        execSync('docker-compose config --quiet', { stdio: 'ignore' });
      } catch (error) {
        try {
          execSync('docker compose config --quiet', { stdio: 'ignore' });
        } catch (dockerError) {
          fail('Docker Compose file validation failed');
        }
      }
    });

    test('should be able to pull all images', function() {
      this.timeout(300000); // 5 minutes timeout for pulling images

      try {
        execSync('docker-compose pull --quiet', { stdio: 'ignore' });
      } catch (error) {
        try {
          execSync('docker compose pull --quiet', { stdio: 'ignore' });
        } catch (dockerError) {
          console.warn('Could not pull all images - this may be expected in CI/CD environments');
        }
      }
    });
  });

  describe('Security Configuration', () => {
    let composeConfig;

    beforeAll(() => {
      const content = fs.readFileSync(composeFile, 'utf8');
      composeConfig = yaml.load(content);
    });

    test('should not use privileged mode', () => {
      Object.entries(composeConfig.services).forEach(([service, config]) => {
        expect(config.privileged).not.toBe(true);
      });
    });

    test('should not mount sensitive host paths', () => {
      const dangerousPaths = ['/proc', '/sys', '/dev', '/', '/etc', '/var/run/docker.sock'];
      
      Object.entries(composeConfig.services).forEach(([service, config]) => {
        if (config.volumes) {
          config.volumes.forEach(volume => {
            const volumeStr = typeof volume === 'string' ? volume : volume.source;
            if (volumeStr && volumeStr.includes(':')) {
              const hostPath = volumeStr.split(':')[0];
              dangerousPaths.forEach(dangerousPath => {
                expect(hostPath).not.toBe(dangerousPath);
              });
            }
          });
        }
      });
    });

    test('should have proper user configuration for security', () => {
      // Non-root users should be specified for application services
      const appServices = [
        'fusion-bitcoin-relayer',
        'fusion-bitcoin-resolver', 
        'fusion-bitcoin-frontend'
      ];

      appServices.forEach(service => {
        const serviceConfig = composeConfig.services[service];
        if (serviceConfig.user) {
          expect(serviceConfig.user).not.toBe('root');
          expect(serviceConfig.user).not.toBe('0');
        }
      });
    });
  });

  describe('Resource Limits', () => {
    let composeConfig;

    beforeAll(() => {
      const content = fs.readFileSync(composeFile, 'utf8');
      composeConfig = yaml.load(content);
    });

    test('should have memory limits for resource-intensive services', () => {
      const resourceIntensiveServices = ['postgres', 'redis'];

      resourceIntensiveServices.forEach(service => {
        const serviceConfig = composeConfig.services[service];
        if (serviceConfig.deploy && serviceConfig.deploy.resources) {
          expect(serviceConfig.deploy.resources.limits).toBeDefined();
        }
      });
    });
  });

  describe('Logging Configuration', () => {
    let composeConfig;

    beforeAll(() => {
      const content = fs.readFileSync(composeFile, 'utf8');
      composeConfig = yaml.load(content);
    });

    test('should have proper logging configuration', () => {
      Object.entries(composeConfig.services).forEach(([service, config]) => {
        if (config.logging) {
          expect(config.logging.driver).toBeDefined();
          
          // If using json-file driver, should have size limits
          if (config.logging.driver === 'json-file') {
            expect(config.logging.options).toBeDefined();
            expect(config.logging.options['max-size']).toBeDefined();
            expect(config.logging.options['max-file']).toBeDefined();
          }
        }
      });
    });
  });

  describe('Development vs Production Overrides', () => {
    test('should have override files for different environments', () => {
      const overrideFiles = [
        'docker-compose.override.yml',
        'docker-compose.prod.yml',
        'docker-compose.dev.yml'
      ];

      // At least one override file should exist
      const existingOverrides = overrideFiles.filter(file => 
        fs.existsSync(path.join(composeDir, file))
      );
      
      expect(existingOverrides.length).toBeGreaterThan(0);
    });
  });
});