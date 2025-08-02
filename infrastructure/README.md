# Infrastructure Documentation for Fusion Bitcoin Bridge

This document provides comprehensive information about the infrastructure setup, deployment procedures, and management of the 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin project.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Infrastructure Components](#infrastructure-components)
- [Environment Setup](#environment-setup)
- [Deployment Procedures](#deployment-procedures)
- [Monitoring and Logging](#monitoring-and-logging)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Maintenance](#maintenance)

## Overview

The Fusion Bitcoin Bridge infrastructure is designed as a cloud-native, scalable, and secure platform that supports cross-chain swaps between Bitcoin and Ethereum networks. The infrastructure is built using Infrastructure as Code (IaC) principles with Terraform and containerized using Kubernetes.

### Key Features

- **Multi-environment Support**: Local development, staging, and production environments
- **Cloud-native Architecture**: AWS-based infrastructure with EKS, RDS, and ElastiCache
- **Infrastructure as Code**: Terraform for resource provisioning
- **Container Orchestration**: Kubernetes with Kustomize for application deployment
- **Comprehensive Monitoring**: Prometheus, Grafana, and CloudWatch integration
- **Security-first Design**: WAF, VPC isolation, encryption at rest and in transit
- **Automated Backups**: Database and Redis backups with retention policies
- **Cost Optimization**: Spot instances, lifecycle policies, and resource quotas

## Architecture

### High-Level Architecture

```
Internet → CloudFront → ALB → EKS Cluster
                              ├── Relayer Service
                              ├── Resolver Service  
                              ├── Frontend Service
                              └── Monitoring Stack
                                  
                       RDS PostgreSQL ← Services → ElastiCache Redis
                       S3 Buckets ← Backups/Artifacts → CloudWatch Logs
```

### Network Architecture

- **VPC**: Isolated network with public, private, and database subnets
- **Multi-AZ Deployment**: High availability across multiple availability zones
- **NAT Gateways**: Outbound internet access for private resources
- **VPC Endpoints**: Secure communication with AWS services
- **Network Policies**: Kubernetes network segmentation

### Security Architecture

- **IAM Roles**: Service-specific permissions with least privilege
- **Security Groups**: Network-level access control
- **WAF**: Web application firewall with custom rules
- **KMS Encryption**: Encryption keys for all data at rest
- **TLS/SSL**: All communications encrypted in transit

## Infrastructure Components

### Terraform Modules

| Component | Purpose | Location |
|-----------|---------|----------|
| **VPC** | Network infrastructure | `infrastructure/terraform/vpc.tf` |
| **EKS** | Kubernetes cluster | `infrastructure/terraform/eks.tf` |
| **RDS** | PostgreSQL database | `infrastructure/terraform/rds.tf` |
| **Redis** | ElastiCache cluster | `infrastructure/terraform/redis.tf` |
| **S3** | Object storage | `infrastructure/terraform/s3.tf` |
| **ALB** | Load balancer | `infrastructure/terraform/alb.tf` |
| **Security** | WAF, IAM, security groups | `infrastructure/terraform/security.tf` |
| **Monitoring** | CloudWatch, dashboards | `infrastructure/terraform/monitoring.tf` |

### Kubernetes Resources

| Resource Type | Purpose | Location |
|---------------|---------|----------|
| **Base** | Common resources | `infrastructure/kubernetes/base/` |
| **Environments** | Environment-specific configs | `infrastructure/kubernetes/environments/` |
| **Monitoring** | Prometheus, Grafana | `infrastructure/kubernetes/base/monitoring.yaml` |
| **Storage** | PVCs, StorageClasses | `infrastructure/kubernetes/base/storage.yaml` |
| **RBAC** | Security policies | `infrastructure/kubernetes/base/rbac.yaml` |

### Docker Compose

| File | Purpose | Location |
|------|---------|----------|
| **Main** | Primary services | `infrastructure/docker-compose/docker-compose.yml` |
| **Monitoring** | Monitoring stack | `infrastructure/docker-compose/docker-compose.monitoring.yml` |
| **Environment** | Local dev config | `infrastructure/docker-compose/.env.example` |

## Environment Setup

### Prerequisites

1. **Tools Installation**:

   ```bash
   # Install required tools
   brew install terraform kubectl kustomize docker-compose aws-cli
   
   # Or using package manager of your choice
   ```

2. **AWS Configuration**:

   ```bash
   # Configure AWS credentials
   aws configure
   
   # Verify access
   aws sts get-caller-identity
   ```

3. **Docker Setup**:

   ```bash
   # Ensure Docker is running
   docker info
   ```

### Environment Variables

Create environment-specific variable files:

**Local Development** (`.env`):

```bash
NODE_ENV=development
LOG_LEVEL=debug
DB_PASSWORD=localdev123
REDIS_PASSWORD=""
# ... other local-specific variables
```

**Staging/Production**:
Use AWS Secrets Manager and environment-specific tfvars files.

## Deployment Procedures

### Local Development

1. **Start Local Environment**:

   ```bash
   # Navigate to project root
   cd /path/to/fusion-bitcoin-bridge
   
   # Start all services
   ./scripts/infrastructure/manage-local-dev.sh start
   
   # Check status
   ./scripts/infrastructure/manage-local-dev.sh status
   ```

2. **Access Services**:
   - Frontend: <http://localhost:3002>
   - Relayer API: <http://localhost:3000>
   - Resolver API: <http://localhost:3001>
   - Prometheus: <http://localhost:9090>
   - Grafana: <http://localhost:3000> (admin/admin123)

### Infrastructure Deployment

1. **Deploy Infrastructure**:

   ```bash
   # Plan infrastructure changes
   ./scripts/infrastructure/deploy-infrastructure.sh -e staging -a plan
   
   # Apply infrastructure
   ./scripts/infrastructure/deploy-infrastructure.sh -e staging -a apply
   ```

2. **Deploy Applications**:

   ```bash
   # Deploy to Kubernetes
   ./scripts/infrastructure/deploy-kubernetes.sh -e staging -a apply -w
   ```

### Production Deployment

Production deployments require additional safeguards:

1. **Infrastructure Review**:

   ```bash
   # Generate and review plan
   ./scripts/infrastructure/deploy-infrastructure.sh -e production -a plan
   
   # Review changes with team
   # Apply with confirmation
   ./scripts/infrastructure/deploy-infrastructure.sh -e production -a apply
   ```

2. **Application Deployment**:

   ```bash
   # Deploy with wait and health checks
   ./scripts/infrastructure/deploy-kubernetes.sh -e production -a apply -w
   ```

## Monitoring and Logging

### CloudWatch Integration

- **Log Groups**: Centralized logging for all services
- **Dashboards**: Infrastructure and application metrics
- **Alarms**: Automated alerts for critical issues
- **X-Ray Tracing**: Distributed tracing for request flows

### Prometheus Stack

- **Metrics Collection**: Application and infrastructure metrics
- **Alert Rules**: Custom alerting rules for business logic
- **Grafana Dashboards**: Visual monitoring and analysis
- **Service Discovery**: Automatic service endpoint discovery

### Key Metrics to Monitor

| Metric Category | Key Metrics |
|-----------------|-------------|
| **Application** | Request rate, error rate, response time |
| **Infrastructure** | CPU, memory, disk usage |
| **Database** | Connection count, query performance |
| **Network** | Load balancer health, network throughput |
| **Security** | WAF blocks, failed authentications |

### Alerting Rules

Critical alerts are configured for:

- Service downtime (> 1 minute)
- High error rates (> 5% for 2 minutes)
- Resource exhaustion (CPU > 80%, Memory > 90%)
- Database connectivity issues
- Security incidents

## Security

### Network Security

- **VPC Isolation**: All resources deployed in private VPC
- **Security Groups**: Restrictive ingress/egress rules
- **NACLs**: Additional network-level protection
- **WAF Rules**: Protection against common attacks

### Data Security

- **Encryption at Rest**: All data encrypted using AWS KMS
- **Encryption in Transit**: TLS 1.2+ for all communications
- **Secret Management**: AWS Secrets Manager integration
- **Key Rotation**: Automated key rotation policies

### Access Control

- **IAM Roles**: Service-specific roles with minimal permissions
- **RBAC**: Kubernetes role-based access control
- **MFA**: Multi-factor authentication for human access
- **Audit Logging**: All access logged and monitored

### Compliance

- **AWS Config**: Resource compliance monitoring
- **GuardDuty**: Threat detection and response
- **VPC Flow Logs**: Network traffic monitoring
- **CloudTrail**: API call auditing

## Troubleshooting

### Common Issues

#### Infrastructure Issues

1. **Terraform State Conflicts**:

   ```bash
   # Check state lock
   terraform force-unlock LOCK_ID
   
   # Refresh state
   terraform refresh
   ```

2. **Resource Limits**:

   ```bash
   # Check AWS service limits
   aws service-quotas get-service-quota --service-code eks --quota-code L-1194D53C
   
   # Request limit increases if needed
   ```

#### Kubernetes Issues

1. **Pod Startup Issues**:

   ```bash
   # Check pod logs
   kubectl logs -f deployment/fusion-bitcoin-relayer -n fusion-bitcoin
   
   # Describe pod for events
   kubectl describe pod POD_NAME -n fusion-bitcoin
   ```

2. **Service Connectivity**:

   ```bash
   # Test service connectivity
   kubectl exec -it POD_NAME -n fusion-bitcoin -- curl http://SERVICE_NAME:PORT/health
   
   # Check service endpoints
   kubectl get endpoints -n fusion-bitcoin
   ```

#### Application Issues

1. **Database Connectivity**:

   ```bash
   # Test database connection
   kubectl exec -it deployment/fusion-bitcoin-relayer -n fusion-bitcoin -- \
     psql -h DB_HOST -U DB_USER -d DB_NAME -c "SELECT 1;"
   ```

2. **Redis Connectivity**:

   ```bash
   # Test Redis connection
   kubectl exec -it deployment/fusion-bitcoin-relayer -n fusion-bitcoin -- \
     redis-cli -h REDIS_HOST -p REDIS_PORT ping
   ```

### Debug Commands

```bash
# Check all resources
kubectl get all -n fusion-bitcoin

# View recent events
kubectl get events -n fusion-bitcoin --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pods -n fusion-bitcoin
kubectl top nodes

# Export resources for analysis
kubectl get all -n fusion-bitcoin -o yaml > debug-export.yaml
```

## Maintenance

### Regular Tasks

#### Daily

- Monitor alerts and dashboards
- Check backup completion
- Review error logs

#### Weekly

- Update security patches
- Review resource utilization
- Check certificate expiration

#### Monthly

- Review and optimize costs
- Update documentation
- Test disaster recovery procedures

### Backup and Recovery

#### Database Backups

- **Automated**: Daily backups with 30-day retention
- **Manual**: On-demand backups before major changes
- **Cross-region**: Replicated to secondary region (production)

#### Recovery Procedures

1. **Point-in-time Recovery**:

   ```bash
   # Restore from automated backup
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier fusion-bitcoin-restored \
     --db-snapshot-identifier snapshot-id
   ```

2. **Full Environment Recovery**:

   ```bash
   # Deploy infrastructure
   ./scripts/infrastructure/deploy-infrastructure.sh -e production -a apply
   
   # Restore from backup
   # Deploy applications
   ./scripts/infrastructure/deploy-kubernetes.sh -e production -a apply
   ```

### Updates and Upgrades

#### Infrastructure Updates

- Use Terraform to manage infrastructure changes
- Test in staging environment first
- Plan maintenance windows for production updates

#### Application Updates

- Use Kubernetes rolling updates
- Implement blue-green deployments for major changes
- Monitor metrics during and after updates

### Cost Optimization

#### Strategies

- Use Spot instances for non-critical workloads
- Implement resource quotas and limits
- Regular review of unused resources
- Optimize storage lifecycle policies

#### Cost Monitoring

- AWS Cost Explorer integration
- Resource tagging for cost allocation
- Regular cost reviews and optimization

## Support and Contacts

### Emergency Contacts

- **Infrastructure**: DevOps Team
- **Security**: Security Team  
- **On-call**: PagerDuty integration

### Resources

- **Runbooks**: `docs/runbooks/`
- **Architecture Diagrams**: `docs/architecture/`
- **API Documentation**: `docs/api/`

### Useful Links

- [AWS Console](https://console.aws.amazon.com/)
- [Kubernetes Dashboard](https://kubernetes-dashboard.example.com/)
- [Grafana](https://grafana.example.com/)
- [CloudWatch](https://console.aws.amazon.com/cloudwatch/)

---

This documentation is maintained by the DevOps team and updated regularly. For questions or issues, please contact the team or create an issue in the project repository.
