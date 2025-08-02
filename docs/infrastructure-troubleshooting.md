# Infrastructure Troubleshooting Guide - Fusion Bitcoin Bridge

## Table of Contents

- [General Troubleshooting Approach](#general-troubleshooting-approach)
- [Common Issues and Solutions](#common-issues-and-solutions)
- [Service-Specific Troubleshooting](#service-specific-troubleshooting)
- [Infrastructure Components](#infrastructure-components)
- [Monitoring and Alerting](#monitoring-and-alerting)
- [Emergency Procedures](#emergency-procedures)
- [Performance Troubleshooting](#performance-troubleshooting)
- [Security Incident Response](#security-incident-response)

## General Troubleshooting Approach

### 1. Assessment Phase

1. **Identify the Scope**: Determine if the issue affects a single service or multiple components
2. **Check Service Status**: Use health check scripts and monitoring dashboards
3. **Review Recent Changes**: Check deployment history and configuration changes
4. **Gather Information**: Collect logs, metrics, and error messages

### 2. Investigation Phase

1. **Correlate Events**: Look for patterns in logs and metrics
2. **Check Dependencies**: Verify database, cache, and external service connectivity
3. **Resource Utilization**: Monitor CPU, memory, disk, and network usage
4. **Network Connectivity**: Test internal and external network connections

### 3. Resolution Phase

1. **Apply Fix**: Implement the appropriate solution
2. **Validate**: Confirm the issue is resolved
3. **Document**: Record the issue and resolution for future reference
4. **Monitor**: Continue monitoring to ensure stability

## Common Issues and Solutions

### Application Startup Issues

#### Symptoms

- Pods stuck in `CrashLoopBackOff` state
- Services not responding to health checks
- Connection timeouts

#### Troubleshooting Steps

```bash
# Check pod status and events
kubectl get pods -n fusion-bitcoin
kubectl describe pod <pod-name> -n fusion-bitcoin

# Check application logs
kubectl logs <pod-name> -n fusion-bitcoin --previous
kubectl logs <pod-name> -n fusion-bitcoin -f

# Check resource limits
kubectl describe pod <pod-name> -n fusion-bitcoin | grep -A 5 "Limits\|Requests"
```

#### Common Causes and Solutions

1. **Database Connection Issues**

   ```bash
   # Test database connectivity
   kubectl exec -it <pod-name> -n fusion-bitcoin -- pg_isready -h <db-host> -p 5432
   
   # Check database credentials
   kubectl get secret <db-secret> -n fusion-bitcoin -o yaml
   ```

2. **Resource Constraints**

   ```bash
   # Check node resources
   kubectl describe nodes
   kubectl top nodes
   
   # Increase resource limits in deployment
   resources:
     requests:
       memory: "512Mi"
       cpu: "250m"
     limits:
       memory: "1Gi"
       cpu: "500m"
   ```

3. **Configuration Issues**

   ```bash
   # Check ConfigMaps
   kubectl get configmaps -n fusion-bitcoin
   kubectl describe configmap <config-name> -n fusion-bitcoin
   
   # Validate environment variables
   kubectl exec -it <pod-name> -n fusion-bitcoin -- env | grep -i fusion
   ```

### Database Connectivity Issues

#### Symptoms

- Connection timeouts to database
- "Connection refused" errors
- Slow query performance

#### Troubleshooting Steps

```bash
# Check RDS instance status
aws rds describe-db-instances --db-instance-identifier fusion-bitcoin-${ENV}-db

# Test connection from application pod
kubectl exec -it <pod-name> -n fusion-bitcoin -- telnet <db-endpoint> 5432

# Check connection pool status
kubectl exec -it <pod-name> -n fusion-bitcoin -- netstat -an | grep 5432
```

#### Common Solutions

1. **Security Group Issues**

   ```bash
   # Check security group rules
   aws ec2 describe-security-groups --group-ids <db-security-group-id>
   
   # Add rule if needed
   aws ec2 authorize-security-group-ingress \
     --group-id <db-security-group-id> \
     --protocol tcp \
     --port 5432 \
     --source-group <app-security-group-id>
   ```

2. **Connection Pool Exhaustion**
   - Check application connection pool configuration
   - Increase `max_connections` in RDS parameter group
   - Implement connection pooling with PgBouncer

3. **Database Performance**

   ```bash
   # Check slow queries
   kubectl exec -it <postgres-pod> -- psql -U postgres -c "
   SELECT query, calls, total_time, mean_time 
   FROM pg_stat_statements 
   ORDER BY mean_time DESC 
   LIMIT 10;"
   ```

### Redis/Cache Issues

#### Symptoms

- Cache misses or timeouts
- Memory pressure alerts
- Connection failures

#### Troubleshooting Steps

```bash
# Check ElastiCache cluster status
aws elasticache describe-cache-clusters --cache-cluster-id fusion-bitcoin-${ENV}-redis

# Test Redis connectivity
kubectl exec -it <pod-name> -n fusion-bitcoin -- redis-cli -h <redis-endpoint> ping

# Check Redis memory usage
kubectl exec -it <pod-name> -n fusion-bitcoin -- redis-cli -h <redis-endpoint> info memory
```

#### Common Solutions

1. **Memory Issues**

   ```bash
   # Check memory usage
   redis-cli info memory | grep used_memory_human
   
   # Clear cache if needed (use with caution)
   redis-cli flushdb
   ```

2. **Connection Limits**
   - Increase `maxclients` parameter in ElastiCache
   - Implement connection pooling in application

### Load Balancer Issues

#### Symptoms

- 502/503 errors from load balancer
- Health check failures
- Uneven traffic distribution

#### Troubleshooting Steps

```bash
# Check ALB target group health
aws elbv2 describe-target-health --target-group-arn <target-group-arn>

# Check ALB access logs
aws logs filter-log-events \
  --log-group-name /aws/applicationloadbalancer/app/fusion-bitcoin-alb \
  --start-time 1640995200000

# Check service endpoints
kubectl get endpoints -n fusion-bitcoin
```

#### Common Solutions

1. **Health Check Configuration**

   ```yaml
   # Kubernetes liveness/readiness probes
   livenessProbe:
     httpGet:
       path: /health
       port: 3000
     initialDelaySeconds: 30
     periodSeconds: 10
   
   readinessProbe:
     httpGet:
       path: /ready
       port: 3000
     initialDelaySeconds: 5
     periodSeconds: 5
   ```

2. **Target Registration Issues**
   - Verify security groups allow ALB to reach targets
   - Check that pods are ready and passing health checks
   - Verify service selectors match pod labels

## Service-Specific Troubleshooting

### Relayer Service

#### Common Issues

1. **Blockchain Connection Failures**

   ```bash
   # Check blockchain node connectivity
   kubectl exec -it <relayer-pod> -- curl -X POST -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}' \
     <ethereum-node-url>
   ```

2. **Transaction Processing Delays**

   ```bash
   # Check pending transactions
   kubectl logs <relayer-pod> -n fusion-bitcoin | grep "pending"
   
   # Monitor gas prices and network congestion
   kubectl exec -it <relayer-pod> -- curl <gas-price-api>
   ```

### Resolver Service

#### Common Issues

1. **Liquidity Pool Issues**

   ```bash
   # Check liquidity metrics
   kubectl exec -it <resolver-pod> -- curl localhost:3001/metrics | grep liquidity
   
   # Check external liquidity sources
   kubectl logs <resolver-pod> -n fusion-bitcoin | grep "liquidity"
   ```

2. **Price Feed Problems**

   ```bash
   # Test price feed endpoints
   kubectl exec -it <resolver-pod> -- curl <price-feed-url>
   
   # Check price staleness
   kubectl logs <resolver-pod> -n fusion-bitcoin | grep "stale"
   ```

### Frontend Service

#### Common Issues

1. **Static Asset Loading**

   ```bash
   # Check CDN status
   curl -I https://<cloudfront-domain>/static/js/main.js
   
   # Verify S3 bucket access
   aws s3 ls s3://fusion-bitcoin-frontend-${ENV}
   ```

2. **API Communication**

   ```bash
   # Test backend API connectivity
   kubectl exec -it <frontend-pod> -- curl <backend-api-url>/health
   ```

## Infrastructure Components

### EKS Cluster Issues

#### Node Issues

```bash
# Check node status
kubectl get nodes
kubectl describe node <node-name>

# Check node resources
kubectl top nodes

# Check system pods
kubectl get pods -n kube-system
```

#### Common Solutions

1. **Node Not Ready**
   - Check kubelet logs: `journalctl -u kubelet`
   - Verify network connectivity
   - Check disk space and memory

2. **Pod Scheduling Issues**

   ```bash
   # Check pod events
   kubectl describe pod <pod-name>
   
   # Check resource availability
   kubectl describe nodes | grep -A 5 "Allocated resources"
   ```

### Terraform State Issues

#### State Lock Problems

```bash
# Check DynamoDB lock table
aws dynamodb scan --table-name fusion-bitcoin-terraform-locks-${ENV}

# Force unlock (use with extreme caution)
terraform force-unlock <lock-id>
```

#### State Drift

```bash
# Check for configuration drift
terraform plan -detailed-exitcode

# Refresh state
terraform refresh
```

## Monitoring and Alerting

### Key Metrics to Monitor

#### Application Metrics

- Request rate and latency
- Error rate and success rate
- Database connection pool usage
- Cache hit/miss ratio

#### Infrastructure Metrics

- CPU and memory utilization
- Disk space and I/O
- Network throughput
- Load balancer response times

### Alert Investigation

#### High Error Rate

```bash
# Check application logs for errors
kubectl logs -l app=fusion-bitcoin-relayer -n fusion-bitcoin | grep -i error

# Check database connectivity
kubectl exec -it <pod> -- pg_isready -h <db-host>

# Check external dependencies
curl -I <external-api-url>
```

#### High Latency

```bash
# Check slow queries
kubectl exec -it <postgres-pod> -- psql -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"

# Check network latency
kubectl exec -it <pod> -- ping <external-host>

# Check resource utilization
kubectl top pods -n fusion-bitcoin
```

## Emergency Procedures

### Service Outage Response

#### Immediate Actions (0-15 minutes)

1. **Assess Impact**: Determine affected services and user impact
2. **Check Status Page**: Update status page if customer-facing
3. **Initial Investigation**: Check obvious issues (deployment, infrastructure alerts)
4. **Escalate**: Contact on-call engineers if needed

#### Short-term Actions (15-60 minutes)

1. **Deep Investigation**: Analyze logs, metrics, and traces
2. **Apply Hotfixes**: Implement immediate fixes if possible
3. **Rollback**: Rollback recent deployments if they caused the issue
4. **Communication**: Update stakeholders and customers

#### Long-term Actions (1+ hours)

1. **Root Cause Analysis**: Conduct thorough investigation
2. **Permanent Fix**: Implement proper fix and testing
3. **Post-Mortem**: Document lessons learned
4. **Prevention**: Implement preventive measures

### Rollback Procedures

#### Application Rollback

```bash
# Rollback Kubernetes deployment
kubectl rollout undo deployment/fusion-bitcoin-relayer -n fusion-bitcoin

# Check rollback status
kubectl rollout status deployment/fusion-bitcoin-relayer -n fusion-bitcoin

# Verify application health
kubectl get pods -n fusion-bitcoin
```

#### Infrastructure Rollback

```bash
# Terraform rollback (restore from backup state)
terraform init
terraform plan -target=<specific-resource>
terraform apply -target=<specific-resource>
```

### Database Emergency Procedures

#### Database Failover

```bash
# Check RDS failover status
aws rds describe-db-instances --db-instance-identifier <db-identifier>

# Trigger manual failover if needed
aws rds failover-db-cluster --db-cluster-identifier <cluster-identifier>
```

#### Point-in-Time Recovery

```bash
# List available recovery points
aws rds describe-db-snapshots --db-instance-identifier <db-identifier>

# Restore to point in time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier <source-db> \
  --target-db-instance-identifier <target-db> \
  --restore-time <timestamp>
```

## Performance Troubleshooting

### Database Performance

#### Slow Queries

```sql
-- Find slow queries
SELECT query, calls, total_time, mean_time, stddev_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 20;

-- Check active queries
SELECT pid, now() - query_start as duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - query_start > interval '5 minutes';
```

#### Connection Issues

```sql
-- Check connection count
SELECT state, count(*)
FROM pg_stat_activity
GROUP BY state;

-- Find long-running transactions
SELECT pid, now() - xact_start as duration, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL AND now() - xact_start > interval '10 minutes';
```

### Application Performance

#### Memory Leaks

```bash
# Monitor memory usage over time
kubectl top pods -n fusion-bitcoin --containers

# Get detailed memory statistics
kubectl exec -it <pod> -- cat /proc/meminfo
kubectl exec -it <pod> -- cat /sys/fs/cgroup/memory/memory.usage_in_bytes
```

#### CPU Issues

```bash
# Check CPU usage patterns
kubectl exec -it <pod> -- top -b -n 1

# Profile application (if profiling endpoints available)
curl <pod-ip>:3000/debug/pprof/profile > cpu.prof
```

## Security Incident Response

### Security Alert Investigation

#### Unusual Access Patterns

```bash
# Check CloudTrail logs
aws logs filter-log-events \
  --log-group-name CloudTrail/FusionBitcoin \
  --filter-pattern "{ $.errorCode = \"*Denied*\" || $.errorCode = \"*Failed*\" }"

# Check VPC Flow Logs
aws logs filter-log-events \
  --log-group-name /aws/vpc/flowlogs \
  --filter-pattern "REJECT"
```

#### Suspicious Network Activity

```bash
# Check security group modifications
aws ec2 describe-security-groups --query 'SecurityGroups[?IpPermissions[?FromPort==`22`]]'

# Monitor unusual connections
kubectl exec -it <pod> -- netstat -antp | grep ESTABLISHED
```

### Incident Containment

1. **Isolate**: Remove affected resources from load balancer
2. **Block**: Update security groups to block malicious traffic
3. **Preserve**: Take snapshots/backups for forensic analysis
4. **Notify**: Alert security team and stakeholders

### Recovery Steps

1. **Patch**: Apply security patches and updates
2. **Rotate**: Rotate all credentials and certificates
3. **Validate**: Perform security validation before restoration
4. **Monitor**: Enhanced monitoring during recovery period

## Getting Help

### Internal Resources

- On-call rotation and escalation procedures
- Internal documentation and runbooks
- Team communication channels (Slack, PagerDuty)

### External Resources

- AWS Support (if applicable)
- Community forums and documentation
- Vendor support contacts

### Documentation

- Update this troubleshooting guide with new issues and solutions
- Maintain incident post-mortem documentation
- Keep escalation procedures current

Remember: When in doubt, escalate early and communicate frequently!
