# Disaster Recovery Runbook - Fusion Bitcoin Bridge

## Table of Contents

- [Overview](#overview)
- [Incident Classification](#incident-classification)
- [Recovery Objectives](#recovery-objectives)
- [Disaster Recovery Team](#disaster-recovery-team)
- [Communication Plan](#communication-plan)
- [Recovery Procedures](#recovery-procedures)
- [Testing and Validation](#testing-and-validation)
- [Post-Recovery Activities](#post-recovery-activities)
- [Prevention and Monitoring](#prevention-and-monitoring)

## Overview

This runbook provides step-by-step procedures for disaster recovery scenarios affecting the Fusion Bitcoin Bridge infrastructure. It covers various disaster scenarios from partial service outages to complete infrastructure failure.

### Scope

- Production infrastructure in AWS us-west-2 region
- All application services (Relayer, Resolver, Frontend)
- Database systems (PostgreSQL, Redis)
- Supporting infrastructure (Load Balancers, CDN, DNS)

### Assumptions

- Disaster recovery procedures are executed by trained personnel
- Communication channels are established and functional
- Access to recovery resources is available
- Backups are current and verified

## Incident Classification

### Severity Levels

#### Severity 1 (Critical)

- **Definition**: Complete service outage affecting all users
- **Examples**: Region-wide outage, complete database failure, security breach
- **Response Time**: Immediate (0-15 minutes)
- **Recovery Time Objective (RTO)**: 4 hours
- **Recovery Point Objective (RPO)**: 1 hour

#### Severity 2 (High)

- **Definition**: Major service degradation affecting significant user base
- **Examples**: Single service failure, database performance issues, partial network outage
- **Response Time**: 30 minutes
- **RTO**: 8 hours
- **RPO**: 4 hours

#### Severity 3 (Medium)

- **Definition**: Minor service impact with workarounds available
- **Examples**: Non-critical service failure, monitoring system issues
- **Response Time**: 2 hours
- **RTO**: 24 hours
- **RPO**: 8 hours

#### Severity 4 (Low)

- **Definition**: Minimal impact on service availability
- **Examples**: Cosmetic issues, non-critical alerts
- **Response Time**: Next business day
- **RTO**: 72 hours
- **RPO**: 24 hours

## Recovery Objectives

### Production Environment

- **RTO**: 4 hours (complete service restoration)
- **RPO**: 1 hour (maximum data loss)
- **Availability**: 99.9% uptime target
- **Data Integrity**: Zero tolerance for data corruption

### Staging Environment

- **RTO**: 8 hours
- **RPO**: 4 hours
- **Purpose**: Testing and validation support

## Disaster Recovery Team

### Incident Commander

- **Primary**: DevOps Lead
- **Backup**: Senior Developer
- **Responsibilities**: Overall incident coordination, decision making, external communication

### Technical Teams

#### Infrastructure Team

- **Members**: DevOps Engineers, Cloud Architects
- **Responsibilities**: AWS infrastructure, networking, databases

#### Application Team

- **Members**: Backend Developers, Frontend Developers
- **Responsibilities**: Application deployment, configuration, troubleshooting

#### Security Team

- **Members**: Security Engineers
- **Responsibilities**: Security assessment, compliance validation

### Support Teams

#### Communication Team

- **Members**: Product Manager, Customer Success
- **Responsibilities**: Internal and external communication, status updates

#### Business Team

- **Members**: Business Stakeholders
- **Responsibilities**: Business impact assessment, priority decisions

## Communication Plan

### Internal Communication

#### Incident Declaration

1. **Slack**: Post in #incident-response channel
2. **PagerDuty**: Trigger incident alert
3. **Email**: Send to <incident-response@company.com>
4. **Conference Bridge**: Start incident call

#### Status Updates

- **Frequency**: Every 30 minutes for Severity 1, hourly for Severity 2
- **Channels**: Slack, email, status page
- **Content**: Current status, actions taken, next steps, ETA

#### Escalation

- **15 minutes**: Notify immediate team
- **30 minutes**: Escalate to management
- **1 hour**: Executive notification for Severity 1
- **2 hours**: External stakeholder notification

### External Communication

#### Customer Communication

- **Status Page**: Update every 15 minutes for active incidents
- **Social Media**: Major outages and resolutions
- **Direct Notification**: Critical customers for Severity 1 incidents

#### Regulatory Communication

- **Timeline**: Within 24 hours for security incidents
- **Recipients**: Compliance team, legal team
- **Content**: Incident scope, user impact, remediation steps

## Recovery Procedures

### Initial Assessment (0-15 minutes)

#### Incident Verification

```bash
# Run health check script
./scripts/infrastructure/health-check.sh -e production -t all

# Check monitoring dashboards
open https://grafana.company.com/dashboard/fusion-bitcoin

# Verify external service status
curl -I https://fusion-bitcoin.company.com/health
```

#### Impact Assessment

1. **User Impact**: Check error rates and user reports
2. **Service Status**: Verify which services are affected
3. **Data Integrity**: Confirm data consistency
4. **Security**: Rule out security incidents

#### Team Assembly

1. **Page on-call teams** via PagerDuty
2. **Start incident bridge** call
3. **Assign roles** based on incident type
4. **Begin status tracking** in incident management system

### Database Recovery

#### PostgreSQL Recovery

##### Scenario 1: Database Instance Failure

```bash
# Check RDS instance status
aws rds describe-db-instances --db-instance-identifier fusion-bitcoin-prod-db

# If instance is down, check for automated failover
aws rds describe-db-clusters --db-cluster-identifier fusion-bitcoin-prod-cluster

# Manual failover if needed
aws rds failover-db-cluster --db-cluster-identifier fusion-bitcoin-prod-cluster \
  --target-db-instance-identifier fusion-bitcoin-prod-db-replica
```

##### Scenario 2: Data Corruption

```bash
# Stop all application traffic to database
kubectl scale deployment --replicas=0 -n fusion-bitcoin --all

# Assess corruption extent
kubectl exec -it postgres-client -- psql -h <db-host> -U postgres -c "
SELECT schemaname, tablename, attname, n_distinct, correlation 
FROM pg_stats 
WHERE schemaname = 'public';"

# Restore from point-in-time backup
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier fusion-bitcoin-prod-db \
  --target-db-instance-identifier fusion-bitcoin-prod-db-restored \
  --restore-time $(date -d "1 hour ago" --iso-8601)
```

##### Scenario 3: Complete Database Loss

```bash
# Restore from latest backup
LATEST_BACKUP=$(aws s3 ls s3://fusion-bitcoin-backups-production/database/ | \
  grep postgresql | sort | tail -1 | awk '{print $4}')

# Create new RDS instance
aws rds create-db-instance \
  --db-instance-identifier fusion-bitcoin-prod-db-new \
  --db-instance-class db.r5.large \
  --engine postgres \
  --master-username fusionbitcoin \
  --allocated-storage 100 \
  --vpc-security-group-ids sg-xxxxx

# Restore data
aws s3 cp s3://fusion-bitcoin-backups-production/database/$LATEST_BACKUP /tmp/
psql -h <new-db-host> -U fusionbitcoin -d fusion_bitcoin < /tmp/$LATEST_BACKUP
```

#### Redis Recovery

##### Scenario 1: Cache Cluster Failure

```bash
# Check ElastiCache status
aws elasticache describe-cache-clusters --cache-cluster-id fusion-bitcoin-prod-redis

# Create new cache cluster if needed
aws elasticache create-cache-cluster \
  --cache-cluster-id fusion-bitcoin-prod-redis-new \
  --cache-node-type cache.r5.large \
  --engine redis \
  --num-cache-nodes 1

# Applications should handle cache misses gracefully
# No data restoration needed for cache layer
```

### Application Recovery

#### EKS Cluster Recovery

##### Scenario 1: Partial Node Failure

```bash
# Check node status
kubectl get nodes
kubectl describe nodes | grep -i "ready\|schedulable"

# Cordon and drain failed nodes
kubectl cordon <failed-node>
kubectl drain <failed-node> --ignore-daemonsets --delete-emptydir-data

# Replace node in Auto Scaling Group
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name fusion-bitcoin-prod-nodes \
  --desired-capacity $(($(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names fusion-bitcoin-prod-nodes \
    --query 'AutoScalingGroups[0].DesiredCapacity') + 1))
```

##### Scenario 2: Complete Cluster Failure

```bash
# Deploy new EKS cluster using Terraform
cd infrastructure/terraform
terraform init
terraform plan -target=aws_eks_cluster.fusion_bitcoin
terraform apply -target=aws_eks_cluster.fusion_bitcoin

# Update kubeconfig
aws eks update-kubeconfig --region us-west-2 --name fusion-bitcoin-prod

# Restore applications from backup
kubectl apply -k infrastructure/kubernetes/environments/production/

# Restore application data from backups
./scripts/infrastructure/backup-disaster-recovery.sh -e production -a restore -t application
```

#### Service-Specific Recovery

##### Relayer Service Recovery

```bash
# Check service status
kubectl get pods -n fusion-bitcoin -l app=fusion-bitcoin-relayer

# Check service configuration
kubectl get configmap relayer-config -n fusion-bitcoin -o yaml

# Redeploy if needed
kubectl rollout restart deployment/fusion-bitcoin-relayer -n fusion-bitcoin

# Verify blockchain connectivity
kubectl exec -it <relayer-pod> -n fusion-bitcoin -- curl -X POST \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}' \
  $ETH_NODE_URL
```

##### Resolver Service Recovery

```bash
# Check liquidity pool connections
kubectl logs -l app=fusion-bitcoin-resolver -n fusion-bitcoin | grep -i liquidity

# Verify price feed connectivity
kubectl exec -it <resolver-pod> -n fusion-bitcoin -- curl $PRICE_FEED_URL

# Restart service if configuration issues
kubectl rollout restart deployment/fusion-bitcoin-resolver -n fusion-bitcoin
```

##### Frontend Service Recovery

```bash
# Check CDN status
curl -I https://d1234567890.cloudfront.net/

# Verify backend API connectivity
kubectl exec -it <frontend-pod> -n fusion-bitcoin -- curl \
  http://fusion-bitcoin-relayer:3000/health

# Update DNS if needed
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch file://dns-change.json
```

### Infrastructure Recovery

#### Network Recovery

##### Load Balancer Issues

```bash
# Check ALB status
aws elbv2 describe-load-balancers --names fusion-bitcoin-prod-alb

# Check target group health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-west-2:123456789:targetgroup/fusion-bitcoin/abc123

# Create new load balancer if needed
terraform apply -target=aws_lb.fusion_bitcoin_alb
```

##### DNS Issues

```bash
# Check Route53 health checks
aws route53 get-health-check --health-check-id Z123456789

# Update DNS records if needed
aws route53 change-resource-record-sets \
  --hosted-zone-id Z987654321 \
  --change-batch file://dns-failover.json
```

#### Cross-Region Recovery

##### Full Region Failover

```bash
# Pre-requisite: Disaster recovery region setup (us-east-1)

# 1. Update DNS to point to DR region
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "fusion-bitcoin.company.com",
        "Type": "A",
        "AliasTarget": {
          "DNSName": "fusion-bitcoin-dr-alb-123456789.us-east-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true,
          "HostedZoneId": "Z35SXDOTRQ7X7K"
        }
      }
    }]
  }'

# 2. Scale up DR infrastructure
cd infrastructure/terraform-dr
terraform init
terraform apply -var="instance_count=3"

# 3. Restore latest data backups to DR region
aws s3 sync s3://fusion-bitcoin-backups-production/ s3://fusion-bitcoin-backups-dr/

# 4. Update applications to use DR region resources
kubectl apply -k infrastructure/kubernetes/environments/dr/
```

### Security Incident Recovery

#### Suspected Breach Response

```bash
# 1. Immediate isolation
# Block suspicious traffic
aws ec2 authorize-security-group-ingress \
  --group-id sg-123456 \
  --protocol tcp \
  --port 443 \
  --source-group sg-blocked

# 2. Evidence preservation
# Take snapshots for forensic analysis
aws ec2 create-snapshot \
  --volume-id vol-123456789 \
  --description "Security incident forensic snapshot $(date)"

# 3. Credential rotation
# Rotate all API keys and certificates
kubectl delete secret --all -n fusion-bitcoin
./scripts/security/rotate-credentials.sh

# 4. System hardening
# Apply latest security patches
kubectl patch daemonset <security-agent> -p '{
  "spec": {"template": {"spec": {"containers": [{
    "name": "security-agent",
    "image": "security-agent:latest-patched"
  }]}}}'
```

## Testing and Validation

### Recovery Validation Checklist

#### Database Validation

- [ ] Database connection successful
- [ ] Data integrity verified
- [ ] Performance within acceptable range
- [ ] Backup system functional
- [ ] Replication working (if applicable)

#### Application Validation

- [ ] All services responding to health checks
- [ ] End-to-end functionality working
- [ ] Authentication and authorization functional
- [ ] External integrations operational
- [ ] Monitoring and alerting restored

#### Infrastructure Validation

- [ ] Load balancer distributing traffic
- [ ] DNS resolution working
- [ ] SSL certificates valid
- [ ] CDN functioning properly
- [ ] Network security rules applied

### User Acceptance Testing

```bash
# Automated smoke tests
./scripts/testing/smoke-test.sh --environment production

# Manual verification steps
curl -X POST https://fusion-bitcoin.company.com/api/swap \
  -H "Content-Type: application/json" \
  -d '{"from": "BTC", "to": "ETH", "amount": "0.1"}'

# Monitor key metrics
kubectl top pods -n fusion-bitcoin
```

## Post-Recovery Activities

### Immediate Actions (0-4 hours after recovery)

1. **All Clear Communication**: Notify all stakeholders of service restoration
2. **Monitoring**: Enhanced monitoring for 24-48 hours
3. **Performance Validation**: Verify system performance is within normal ranges
4. **Backup Verification**: Ensure backup systems are functioning

### Short-term Actions (4-24 hours after recovery)

1. **Incident Documentation**: Complete detailed incident report
2. **Customer Communication**: Follow-up communication to affected users
3. **System Optimization**: Apply any performance improvements identified
4. **Security Review**: Conduct security assessment if applicable

### Long-term Actions (1-7 days after recovery)

1. **Post-Mortem**: Conduct blameless post-mortem with all involved teams
2. **Process Improvement**: Update procedures based on lessons learned
3. **Training**: Provide additional training to team members if needed
4. **Prevention**: Implement measures to prevent similar incidents

### Post-Mortem Template

#### Incident Summary

- **Date/Time**:
- **Duration**:
- **Impact**:
- **Root Cause**:

#### Timeline

- **Detection**:
- **Response**:
- **Mitigation**:
- **Resolution**:

#### What Went Well

-
-
-

#### What Could Be Improved

-
-
-

#### Action Items

- [ ] **Action Item 1** - Owner: _**, Due:**_
- [ ] **Action Item 2** - Owner: _**, Due:**_
- [ ] **Action Item 3** - Owner: _**, Due:**_

## Prevention and Monitoring

### Proactive Measures

#### Monitoring and Alerting

- **Infrastructure**: CPU, memory, disk, network metrics
- **Application**: Response times, error rates, throughput
- **Business**: Transaction volumes, user activity
- **Security**: Failed logins, unusual access patterns

#### Automated Recovery

- **Auto-scaling**: Based on load and performance metrics
- **Health Checks**: Automatic service restart on failures
- **Circuit Breakers**: Prevent cascade failures
- **Graceful Degradation**: Maintain partial functionality during issues

#### Regular Testing

- **Monthly**: Backup restoration testing
- **Quarterly**: Disaster recovery drills
- **Annually**: Full-scale disaster recovery exercise
- **Continuous**: Chaos engineering practices

### Documentation Maintenance

- **Monthly**: Review and update contact information
- **Quarterly**: Update recovery procedures based on infrastructure changes
- **After incidents**: Incorporate lessons learned
- **Annually**: Complete runbook review and validation

### Training and Preparedness

- **New team members**: Disaster recovery training within 30 days
- **All team members**: Annual DR training and tabletop exercises
- **Leadership**: Executive briefings on DR capabilities
- **External partners**: Coordinate with vendors and service providers

## Emergency Contacts

### Internal Contacts

- **Incident Commander**: +1-xxx-xxx-xxxx
- **DevOps Lead**: +1-xxx-xxx-xxxx
- **Security Lead**: +1-xxx-xxx-xxxx
- **Executive On-Call**: +1-xxx-xxx-xxxx

### External Contacts

- **AWS Support**: Premium Support Case
- **DNS Provider**: Support ticket system
- **Security Vendor**: +1-xxx-xxx-xxxx
- **Legal/Compliance**: +1-xxx-xxx-xxxx

### Communication Channels

- **Slack**: #incident-response
- **Conference Bridge**: Dial-in info in PagerDuty
- **Status Page**: <https://status.fusion-bitcoin.com>
- **War Room**: Building A, Conference Room 1

Remember: In disaster recovery situations, clear communication and methodical execution of procedures are critical for successful recovery.
