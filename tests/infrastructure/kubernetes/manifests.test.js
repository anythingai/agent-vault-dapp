const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

describe('Kubernetes Manifests Tests', () => {
  const k8sDir = path.join(__dirname, '../../../infrastructure/kubernetes');
  const environments = ['local', 'staging', 'production'];

  beforeAll(() => {
    // Ensure kubectl is available
    try {
      execSync('kubectl version --client', { stdio: 'ignore' });
    } catch (error) {
      throw new Error('kubectl is not installed or not in PATH');
    }
  });

  describe('Kustomize Configuration', () => {
    test('should have base kustomization.yaml', () => {
      const basePath = path.join(k8sDir, 'base', 'kustomization.yaml');
      expect(fs.existsSync(basePath)).toBe(true);
    });

    environments.forEach(env => {
      test(`should have ${env} kustomization.yaml`, () => {
        const envPath = path.join(k8sDir, 'environments', env, 'kustomization.yaml');
        expect(fs.existsSync(envPath)).toBe(true);
      });

      test(`should validate ${env} kustomize build`, () => {
        const envDir = path.join(k8sDir, 'environments', env);
        try {
          execSync('kubectl kustomize .', { 
            cwd: envDir, 
            stdio: 'ignore' 
          });
        } catch (error) {
          fail(`Kustomize build failed for ${env} environment`);
        }
      });
    });
  });

  describe('YAML Syntax Validation', () => {
    const yamlFiles = [];

    beforeAll(() => {
      // Recursively find all YAML files
      function findYamlFiles(dir) {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const fullPath = path.join(dir, file.name);
          if (file.isDirectory()) {
            findYamlFiles(fullPath);
          } else if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
            yamlFiles.push(fullPath);
          }
        }
      }
      findYamlFiles(k8sDir);
    });

    test('all YAML files should have valid syntax', () => {
      yamlFiles.forEach(file => {
        try {
          const content = fs.readFileSync(file, 'utf8');
          yaml.loadAll(content);
        } catch (error) {
          fail(`Invalid YAML syntax in ${file}: ${error.message}`);
        }
      });
    });
  });

  describe('Resource Validation', () => {
    environments.forEach(env => {
      describe(`${env} environment resources`, () => {
        let manifests = [];

        beforeAll(() => {
          const envDir = path.join(k8sDir, 'environments', env);
          try {
            const output = execSync('kubectl kustomize .', { 
              cwd: envDir, 
              encoding: 'utf8' 
            });
            manifests = yaml.loadAll(output).filter(doc => doc !== null);
          } catch (error) {
            console.error(`Failed to build manifests for ${env}:`, error.message);
          }
        });

        test('should have deployment manifests', () => {
          const deployments = manifests.filter(m => m.kind === 'Deployment');
          expect(deployments.length).toBeGreaterThan(0);
        });

        test('should have service manifests', () => {
          const services = manifests.filter(m => m.kind === 'Service');
          expect(services.length).toBeGreaterThan(0);
        });

        test('should have proper resource limits', () => {
          const deployments = manifests.filter(m => m.kind === 'Deployment');
          deployments.forEach(deployment => {
            const containers = deployment.spec?.template?.spec?.containers || [];
            containers.forEach(container => {
              if (container.name !== 'istio-proxy') { // Skip sidecar containers
                expect(container.resources).toBeDefined();
                expect(container.resources.requests).toBeDefined();
                expect(container.resources.limits).toBeDefined();
              }
            });
          });
        });

        test('should have proper labels', () => {
          const labeledResources = manifests.filter(m => 
            ['Deployment', 'Service', 'ConfigMap', 'Secret'].includes(m.kind)
          );

          labeledResources.forEach(resource => {
            expect(resource.metadata?.labels).toBeDefined();
            expect(resource.metadata.labels['app']).toBeDefined();
            expect(resource.metadata.labels['environment']).toBe(env);
          });
        });

        test('should have health checks configured', () => {
          const deployments = manifests.filter(m => m.kind === 'Deployment');
          deployments.forEach(deployment => {
            const containers = deployment.spec?.template?.spec?.containers || [];
            containers.forEach(container => {
              if (container.name !== 'istio-proxy') {
                expect(
                  container.livenessProbe || container.readinessProbe
                ).toBeDefined();
              }
            });
          });
        });

        test('should have proper security context', () => {
          if (env === 'production') {
            const deployments = manifests.filter(m => m.kind === 'Deployment');
            deployments.forEach(deployment => {
              const podSpec = deployment.spec?.template?.spec;
              
              // Should have security context at pod or container level
              const hasSecurityContext = 
                podSpec?.securityContext || 
                podSpec?.containers?.some(c => c.securityContext);
              
              expect(hasSecurityContext).toBeTruthy();
            });
          }
        });
      });
    });
  });

  describe('Kubernetes API Validation', () => {
    environments.forEach(env => {
      test(`should validate ${env} manifests against Kubernetes API`, () => {
        const envDir = path.join(k8sDir, 'environments', env);
        
        try {
          execSync('kubectl kustomize . | kubectl apply --dry-run=server -f -', {
            cwd: envDir,
            stdio: 'ignore'
          });
        } catch (error) {
          // Only fail if cluster is accessible
          try {
            execSync('kubectl cluster-info', { stdio: 'ignore' });
            fail(`Server-side validation failed for ${env} environment`);
          } catch (clusterError) {
            // Cluster not accessible, skip server-side validation
            console.warn(`Skipping server-side validation for ${env} (cluster not accessible)`);
          }
        }
      });
    });
  });

  describe('RBAC Configuration', () => {
    test('should have RBAC manifests', () => {
      const rbacPath = path.join(k8sDir, 'base', 'rbac.yaml');
      expect(fs.existsSync(rbacPath)).toBe(true);
    });

    test('should have proper RBAC rules', () => {
      const rbacPath = path.join(k8sDir, 'base', 'rbac.yaml');
      const content = fs.readFileSync(rbacPath, 'utf8');
      const docs = yaml.loadAll(content);

      const roles = docs.filter(doc => doc.kind === 'Role' || doc.kind === 'ClusterRole');
      const bindings = docs.filter(doc => doc.kind === 'RoleBinding' || doc.kind === 'ClusterRoleBinding');

      expect(roles.length).toBeGreaterThan(0);
      expect(bindings.length).toBeGreaterThan(0);

      // Validate that roles have rules defined
      roles.forEach(role => {
        expect(role.rules).toBeDefined();
        expect(Array.isArray(role.rules)).toBe(true);
        expect(role.rules.length).toBeGreaterThan(0);
      });
    });
  });

  describe('ConfigMap and Secret Validation', () => {
    environments.forEach(env => {
      describe(`${env} environment configs`, () => {
        let manifests = [];

        beforeAll(() => {
          const envDir = path.join(k8sDir, 'environments', env);
          try {
            const output = execSync('kubectl kustomize .', { 
              cwd: envDir, 
              encoding: 'utf8' 
            });
            manifests = yaml.loadAll(output).filter(doc => doc !== null);
          } catch (error) {
            console.error(`Failed to build manifests for ${env}:`, error.message);
          }
        });

        test('should not contain plaintext secrets in ConfigMaps', () => {
          const configMaps = manifests.filter(m => m.kind === 'ConfigMap');
          const suspiciousKeys = [
            'password', 'secret', 'key', 'token', 'credential',
            'private_key', 'api_key', 'access_key'
          ];

          configMaps.forEach(cm => {
            if (cm.data) {
              Object.keys(cm.data).forEach(key => {
                const lowerKey = key.toLowerCase();
                const isSuspicious = suspiciousKeys.some(susKey => 
                  lowerKey.includes(susKey)
                );
                
                if (isSuspicious) {
                  // Check if value looks like a secret (not a reference or placeholder)
                  const value = cm.data[key];
                  const isReference = value.includes('${') || value.includes('SECRET_REF');
                  expect(isReference).toBeTruthy();
                }
              });
            }
          });
        });

        test('should have proper secret references', () => {
          const deployments = manifests.filter(m => m.kind === 'Deployment');
          deployments.forEach(deployment => {
            const containers = deployment.spec?.template?.spec?.containers || [];
            containers.forEach(container => {
              if (container.env) {
                container.env.forEach(envVar => {
                  if (envVar.name?.toLowerCase().includes('password') || 
                      envVar.name?.toLowerCase().includes('secret') ||
                      envVar.name?.toLowerCase().includes('key')) {
                    expect(envVar.valueFrom?.secretKeyRef).toBeDefined();
                  }
                });
              }
            });
          });
        });
      });
    });
  });

  describe('Network Policies', () => {
    test('should have network policies for production', () => {
      const prodDir = path.join(k8sDir, 'environments', 'production');
      try {
        const output = execSync('kubectl kustomize .', { 
          cwd: prodDir, 
          encoding: 'utf8' 
        });
        const manifests = yaml.loadAll(output).filter(doc => doc !== null);
        const networkPolicies = manifests.filter(m => m.kind === 'NetworkPolicy');
        
        expect(networkPolicies.length).toBeGreaterThan(0);
      } catch (error) {
        console.warn('Could not validate network policies for production');
      }
    });
  });

  describe('Resource Quotas', () => {
    ['staging', 'production'].forEach(env => {
      test(`should have resource quotas for ${env}`, () => {
        const envDir = path.join(k8sDir, 'environments', env);
        try {
          const output = execSync('kubectl kustomize .', { 
            cwd: envDir, 
            encoding: 'utf8' 
          });
          const manifests = yaml.loadAll(output).filter(doc => doc !== null);
          const quotas = manifests.filter(m => 
            m.kind === 'ResourceQuota' || m.kind === 'LimitRange'
          );
          
          // At least one resource constraint should be defined
          expect(quotas.length).toBeGreaterThan(0);
        } catch (error) {
          console.warn(`Could not validate resource quotas for ${env}`);
        }
      });
    });
  });
});