#!/bin/bash
# EKS Node Bootstrap Script for Fusion Bitcoin Bridge
# This script runs on each EKS worker node during launch

set -e

# Variables passed from Terraform
CLUSTER_NAME="${cluster_name}"
ENVIRONMENT="${environment}"
NODE_GROUP="${node_group}"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a /var/log/node-bootstrap.log
}

log "Starting node bootstrap for cluster: $CLUSTER_NAME, environment: $ENVIRONMENT, node group: $NODE_GROUP"

# Update system packages
log "Updating system packages..."
yum update -y

# Install required packages
log "Installing required packages..."
yum install -y \
    htop \
    iotop \
    sysstat \
    tcpdump \
    telnet \
    nc \
    jq \
    aws-cli \
    docker \
    containerd \
    amazon-cloudwatch-agent \
    amazon-ssm-agent

# Configure Docker daemon
log "Configuring Docker daemon..."
cat > /etc/docker/daemon.json <<EOF
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "10"
    },
    "storage-driver": "overlay2",
    "live-restore": true,
    "userland-proxy": false,
    "experimental": false,
    "metrics-addr": "127.0.0.1:9323",
    "default-ulimits": {
        "memlock": {
            "Hard": -1,
            "Name": "memlock",
            "Soft": -1
        },
        "nofile": {
            "Hard": 1048576,
            "Name": "nofile", 
            "Soft": 1048576
        }
    }
}
EOF

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Configure containerd
log "Configuring containerd..."
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml

# Modify containerd config for EKS
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

# Start and enable containerd
systemctl restart containerd
systemctl enable containerd

# Configure kubelet extra args based on environment
KUBELET_EXTRA_ARGS=""

if [ "$ENVIRONMENT" = "production" ]; then
    # Production optimizations
    KUBELET_EXTRA_ARGS="--max-pods=50 --kube-reserved=cpu=100m,memory=256Mi,ephemeral-storage=1Gi --system-reserved=cpu=100m,memory=256Mi,ephemeral-storage=1Gi --eviction-hard=memory.available<5%,nodefs.available<10%,imagefs.available<10%"
elif [ "$ENVIRONMENT" = "staging" ]; then
    # Staging optimizations
    KUBELET_EXTRA_ARGS="--max-pods=30 --kube-reserved=cpu=50m,memory=128Mi --system-reserved=cpu=50m,memory=128Mi"
else
    # Local/development optimizations
    KUBELET_EXTRA_ARGS="--max-pods=20"
fi

# Configure kubelet
echo "KUBELET_EXTRA_ARGS=$KUBELET_EXTRA_ARGS" >> /etc/sysconfig/kubelet

# Set up CloudWatch agent for monitoring
log "Configuring CloudWatch agent..."
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
    "agent": {
        "metrics_collection_interval": 60,
        "run_as_user": "cwagent"
    },
    "metrics": {
        "namespace": "FusionBitcoin/EKS",
        "metrics_collected": {
            "cpu": {
                "measurement": [
                    "cpu_usage_idle",
                    "cpu_usage_iowait",
                    "cpu_usage_user",
                    "cpu_usage_system"
                ],
                "metrics_collection_interval": 60,
                "totalcpu": false
            },
            "disk": {
                "measurement": [
                    "used_percent"
                ],
                "metrics_collection_interval": 60,
                "resources": [
                    "*"
                ]
            },
            "diskio": {
                "measurement": [
                    "io_time"
                ],
                "metrics_collection_interval": 60,
                "resources": [
                    "*"
                ]
            },
            "mem": {
                "measurement": [
                    "mem_used_percent"
                ],
                "metrics_collection_interval": 60
            },
            "net": {
                "measurement": [
                    "bytes_sent",
                    "bytes_recv",
                    "packets_sent",
                    "packets_recv"
                ],
                "metrics_collection_interval": 60,
                "resources": [
                    "*"
                ]
            }
        }
    },
    "logs": {
        "logs_collected": {
            "files": {
                "collect_list": [
                    {
                        "file_path": "/var/log/messages",
                        "log_group_name": "/aws/eks/fusion-bitcoin/$ENVIRONMENT/system",
                        "log_stream_name": "{instance_id}-messages"
                    },
                    {
                        "file_path": "/var/log/docker",
                        "log_group_name": "/aws/eks/fusion-bitcoin/$ENVIRONMENT/docker",
                        "log_stream_name": "{instance_id}-docker"
                    },
                    {
                        "file_path": "/var/log/kubelet/kubelet.log",
                        "log_group_name": "/aws/eks/fusion-bitcoin/$ENVIRONMENT/kubelet",
                        "log_stream_name": "{instance_id}-kubelet"
                    }
                ]
            }
        }
    }
}
EOF

# Start CloudWatch agent
systemctl start amazon-cloudwatch-agent
systemctl enable amazon-cloudwatch-agent

# Configure log rotation
log "Configuring log rotation..."
cat > /etc/logrotate.d/kubernetes <<EOF
/var/log/pods/*/*.log {
    daily
    missingok
    rotate 7
    compress
    notifempty
    create 0644 root root
    postrotate
        /bin/kill -USR1 \`cat /run/docker.pid 2> /dev/null\` 2> /dev/null || true
    endscript
}

/var/log/containers/*.log {
    daily
    missingok
    rotate 7
    compress
    notifempty
    create 0644 root root
}
EOF

# Set up system optimizations
log "Applying system optimizations..."

# Kernel parameters for container workloads
cat >> /etc/sysctl.conf <<EOF
# Fusion Bitcoin Bridge EKS Node Optimizations

# Network optimizations
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_probes = 3
net.ipv4.tcp_keepalive_intvl = 30

# Memory management
vm.max_map_count = 262144
vm.swappiness = 1
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5

# File descriptor limits
fs.file-max = 1048576
fs.nr_open = 1048576

# Kubernetes/Docker specific
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
net.netfilter.nf_conntrack_max = 1000000
EOF

# Apply sysctl changes
sysctl -p

# Set up ulimits
cat >> /etc/security/limits.conf <<EOF
* soft nofile 1048576
* hard nofile 1048576
* soft nproc 1048576
* hard nproc 1048576
EOF

# Configure node labels and taints
log "Setting up node labels..."
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
INSTANCE_TYPE=$(curl -s http://169.254.169.254/latest/meta-data/instance-type)
AVAILABILITY_ZONE=$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone)

# Create a script to apply labels after node joins cluster
cat > /usr/local/bin/apply-node-labels.sh <<EOF
#!/bin/bash
# Wait for node to be ready
kubectl wait --for=condition=Ready node/\$(hostname) --timeout=300s

# Apply custom labels
kubectl label node \$(hostname) \
    fusion-bitcoin.1inch.io/environment=$ENVIRONMENT \
    fusion-bitcoin.1inch.io/node-group=$NODE_GROUP \
    fusion-bitcoin.1inch.io/instance-type=$INSTANCE_TYPE \
    fusion-bitcoin.1inch.io/availability-zone=$AVAILABILITY_ZONE \
    --overwrite
EOF

chmod +x /usr/local/bin/apply-node-labels.sh

# Set up monitoring for critical processes
log "Setting up process monitoring..."
cat > /usr/local/bin/monitor-critical-processes.sh <<EOF
#!/bin/bash
# Monitor critical processes and restart if needed

PROCESSES=("kubelet" "docker" "containerd")
LOG_FILE="/var/log/process-monitor.log"

for process in "\${PROCESSES[@]}"; do
    if ! pgrep \$process > /dev/null; then
        echo "\$(date): \$process is not running, attempting restart" >> \$LOG_FILE
        systemctl restart \$process
    fi
done
EOF

chmod +x /usr/local/bin/monitor-critical-processes.sh

# Add to crontab
echo "*/5 * * * * /usr/local/bin/monitor-critical-processes.sh" | crontab -

# Set up disk space monitoring
cat > /usr/local/bin/disk-cleanup.sh <<EOF
#!/bin/bash
# Clean up disk space when usage exceeds threshold

THRESHOLD=80
ROOT_USAGE=\$(df / | tail -1 | awk '{print \$5}' | sed 's/%//')

if [ \$ROOT_USAGE -gt \$THRESHOLD ]; then
    echo "\$(date): Root disk usage is \$ROOT_USAGE%, cleaning up..." >> /var/log/disk-cleanup.log
    
    # Clean Docker images and containers
    docker system prune -f
    
    # Clean up log files
    journalctl --vacuum-time=7d
    
    # Clean up package cache
    yum clean all
fi
EOF

chmod +x /usr/local/bin/disk-cleanup.sh

# Add to crontab
echo "0 */2 * * * /usr/local/bin/disk-cleanup.sh" | crontab -

# Configure AWS CLI region
log "Configuring AWS CLI..."
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
aws configure set region $REGION

# Set up custom metrics collection
log "Setting up custom metrics..."
cat > /usr/local/bin/collect-custom-metrics.sh <<EOF
#!/bin/bash
# Collect custom metrics for Fusion Bitcoin Bridge

NAMESPACE="FusionBitcoin/EKS/Nodes"
INSTANCE_ID=\$(curl -s http://169.254.169.254/latest/meta-data/instance-id)

# Collect container count
CONTAINER_COUNT=\$(docker ps --format "table {{.Names}}" | wc -l)
aws cloudwatch put-metric-data --namespace \$NAMESPACE --metric-data MetricName=ContainerCount,Value=\$CONTAINER_COUNT,Unit=Count,Dimensions=InstanceId=\$INSTANCE_ID,Environment=$ENVIRONMENT,NodeGroup=$NODE_GROUP

# Collect pod count
POD_COUNT=\$(kubectl get pods --all-namespaces --field-selector spec.nodeName=\$(hostname) 2>/dev/null | wc -l)
if [ \$POD_COUNT -gt 0 ]; then
    aws cloudwatch put-metric-data --namespace \$NAMESPACE --metric-data MetricName=PodCount,Value=\$POD_COUNT,Unit=Count,Dimensions=InstanceId=\$INSTANCE_ID,Environment=$ENVIRONMENT,NodeGroup=$NODE_GROUP
fi
EOF

chmod +x /usr/local/bin/collect-custom-metrics.sh

# Add to crontab (every 5 minutes)
echo "*/5 * * * * /usr/local/bin/collect-custom-metrics.sh" | crontab -

# Final system configuration
log "Applying final system configurations..."

# Disable swap
swapoff -a
sed -i '/ swap / s/^/#/' /etc/fstab

# Configure timezone
timedatectl set-timezone UTC

# Enable and start SSM agent
systemctl enable amazon-ssm-agent
systemctl start amazon-ssm-agent

# Create health check script
cat > /usr/local/bin/node-health-check.sh <<EOF
#!/bin/bash
# Health check script for EKS nodes

EXIT_CODE=0

# Check critical services
SERVICES=("kubelet" "docker" "containerd")
for service in "\${SERVICES[@]}"; do
    if ! systemctl is-active --quiet \$service; then
        echo "ERROR: \$service is not running"
        EXIT_CODE=1
    fi
done

# Check disk space
ROOT_USAGE=\$(df / | tail -1 | awk '{print \$5}' | sed 's/%//')
if [ \$ROOT_USAGE -gt 90 ]; then
    echo "ERROR: Root disk usage is \$ROOT_USAGE%"
    EXIT_CODE=1
fi

# Check memory usage
MEM_USAGE=\$(free | grep Mem | awk '{printf "%.0f", \$3/\$2 * 100.0}')
if [ \$MEM_USAGE -gt 95 ]; then
    echo "ERROR: Memory usage is \$MEM_USAGE%"
    EXIT_CODE=1
fi

if [ \$EXIT_CODE -eq 0 ]; then
    echo "Node health check passed"
else
    echo "Node health check failed"
fi

exit \$EXIT_CODE
EOF

chmod +x /usr/local/bin/node-health-check.sh

# Set up node ready signal
cat > /usr/local/bin/signal-node-ready.sh <<EOF
#!/bin/bash
# Signal that node setup is complete

log "Node bootstrap completed successfully"

# Send completion signal to CloudFormation if stack exists
aws cloudformation signal-resource --stack-name $CLUSTER_NAME-nodes --logical-resource-id NodeGroup --unique-id \$HOSTNAME --status SUCCESS 2>/dev/null || true

# Apply node labels
/usr/local/bin/apply-node-labels.sh &
EOF

chmod +x /usr/local/bin/signal-node-ready.sh

log "Node bootstrap script completed successfully"

# Signal completion
/usr/local/bin/signal-node-ready.sh &

exit 0