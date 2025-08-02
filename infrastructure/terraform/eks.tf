# EKS Cluster Configuration for Fusion Bitcoin Bridge
# Creates EKS cluster, node groups, and associated resources

# KMS Key for EKS cluster encryption
resource "aws_kms_key" "eks" {
  description             = "EKS Cluster ${local.name_prefix} encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-eks-key"
    Type = "KMSKey"
  })
}

resource "aws_kms_alias" "eks" {
  name          = "alias/${local.name_prefix}-eks"
  target_key_id = aws_kms_key.eks.key_id
}

# EKS Cluster
module "eks" {
  source = "terraform-aws-modules/eks/aws"
  version = "~> 19.0"

  cluster_name    = "${local.name_prefix}-cluster"
  cluster_version = local.eks_config.cluster_version

  # Networking
  vpc_id                          = module.vpc.vpc_id
  subnet_ids                      = module.vpc.private_subnets
  control_plane_subnet_ids        = module.vpc.private_subnets
  cluster_endpoint_private_access = true
  cluster_endpoint_public_access  = var.environment == "local" ? true : false
  
  # Public access CIDRs (restrict in production)
  cluster_endpoint_public_access_cidrs = var.environment == "production" ? var.production_cidr_blocks : ["0.0.0.0/0"]

  # Encryption
  create_kms_key = false
  cluster_encryption_config = [
    {
      provider_key_arn = aws_kms_key.eks.arn
      resources        = ["secrets"]
    }
  ]

  # Logging
  cluster_enabled_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  cloudwatch_log_group_retention_in_days = var.environment == "production" ? 90 : 30

  # OIDC Provider
  enable_irsa = true

  # Security groups
  cluster_security_group_additional_rules = {
    egress_nodes_ephemeral_ports_tcp = {
      description                = "To node 1025-65535"
      protocol                   = "tcp"
      from_port                  = 1025
      to_port                    = 65535
      type                       = "egress"
      source_node_security_group = true
    }
  }

  node_security_group_additional_rules = {
    ingress_self_all = {
      description = "Node to node all ports/protocols"
      protocol    = "-1"
      from_port   = 0
      to_port     = 0
      type        = "ingress"
      self        = true
    }
    
    ingress_cluster_to_node_all_traffic = {
      description                   = "Cluster API to nodes ports/protocols"
      protocol                      = "-1"
      from_port                     = 0
      to_port                       = 0
      type                          = "ingress"
      source_cluster_security_group = true
    }

    egress_all = {
      description      = "Node all egress"
      protocol         = "-1"
      from_port        = 0
      to_port          = 0
      type             = "egress"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = ["::/0"]
    }
  }

  # Node groups
  eks_managed_node_groups = {
    for name, config in local.eks_config.node_groups : name => {
      name           = "${local.name_prefix}-${name}"
      instance_types = config.instance_types
      capacity_type  = config.capacity_type
      
      min_size     = config.min_size
      max_size     = config.max_size
      desired_size = config.desired_size
      
      disk_size = config.disk_size
      disk_type = "gp3"
      disk_encrypted = true
      disk_kms_key_id = aws_kms_key.eks.arn

      # Launch template
      create_launch_template = true
      launch_template_name   = "${local.name_prefix}-${name}-lt"
      launch_template_use_name_prefix = true
      launch_template_description = "Launch template for ${local.name_prefix}-${name} node group"

      # Remote access (only for non-production)
      remote_access = var.environment != "production" ? {
        ec2_ssh_key = aws_key_pair.eks_nodes[0].key_name
        source_security_group_ids = [aws_security_group.eks_node_ssh[0].id]
      } : null

      # Kubernetes labels
      labels = {
        Environment = var.environment
        NodeGroup   = name
        Application = "fusion-bitcoin-bridge"
      }

      # Kubernetes taints (for spot instances)
      taints = config.capacity_type == "SPOT" ? [
        {
          key    = "spot"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      ] : []

      # User data for additional node configuration
      user_data = base64encode(templatefile("${path.module}/user-data/node-bootstrap.sh", {
        cluster_name = "${local.name_prefix}-cluster"
        environment  = var.environment
        node_group   = name
      }))

      # Instance metadata options
      metadata_options = {
        http_endpoint = "enabled"
        http_tokens   = "required"
        http_put_response_hop_limit = 2
        instance_metadata_tags = "enabled"
      }

      # Update policy
      update_config = {
        max_unavailable_percentage = 25
      }

      tags = merge(local.common_tags, {
        Name = "${local.name_prefix}-${name}-nodes"
        Type = "EKSNodeGroup"
        NodeGroup = name
      })
    }
  }

  # AWS Auth ConfigMap
  manage_aws_auth_configmap = true
  aws_auth_roles = [
    {
      rolearn  = module.eks.eks_managed_node_groups["main"].iam_role_arn
      username = "system:node:{{EC2PrivateDNSName}}"
      groups   = ["system:bootstrappers", "system:nodes"]
    },
  ]

  aws_auth_users = var.environment != "production" ? [
    {
      userarn  = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/admin"
      username = "admin"
      groups   = ["system:masters"]
    },
  ] : []

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cluster"
    Type = "EKSCluster"
  })
}

# Key pair for SSH access to nodes (non-production only)
resource "tls_private_key" "eks_nodes" {
  count = var.environment != "production" ? 1 : 0
  
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "eks_nodes" {
  count = var.environment != "production" ? 1 : 0
  
  key_name   = "${local.name_prefix}-eks-nodes"
  public_key = tls_private_key.eks_nodes[0].public_key_openssh

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-eks-nodes-key"
    Type = "KeyPair"
  })
}

# Security group for SSH access (non-production only)
resource "aws_security_group" "eks_node_ssh" {
  count = var.environment != "production" ? 1 : 0
  
  name_prefix = "${local.name_prefix}-eks-node-ssh-"
  vpc_id      = module.vpc.vpc_id
  description = "Security group for SSH access to EKS nodes"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [local.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-eks-node-ssh-sg"
    Type = "SecurityGroup"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# EKS Add-ons
resource "aws_eks_addon" "vpc_cni" {
  cluster_name             = module.eks.cluster_name
  addon_name               = "vpc-cni"
  addon_version            = data.aws_eks_addon_version.vpc_cni.version
  resolve_conflicts        = "OVERWRITE"
  service_account_role_arn = aws_iam_role.vpc_cni_role.arn

  depends_on = [module.eks.eks_managed_node_groups]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vpc-cni-addon"
    Type = "EKSAddon"
  })
}

resource "aws_eks_addon" "coredns" {
  cluster_name      = module.eks.cluster_name
  addon_name        = "coredns"
  addon_version     = data.aws_eks_addon_version.coredns.version
  resolve_conflicts = "OVERWRITE"

  depends_on = [module.eks.eks_managed_node_groups]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-coredns-addon"
    Type = "EKSAddon"
  })
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name      = module.eks.cluster_name
  addon_name        = "kube-proxy"
  addon_version     = data.aws_eks_addon_version.kube_proxy.version
  resolve_conflicts = "OVERWRITE"

  depends_on = [module.eks.eks_managed_node_groups]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-kube-proxy-addon"
    Type = "EKSAddon"
  })
}

resource "aws_eks_addon" "ebs_csi_driver" {
  cluster_name             = module.eks.cluster_name
  addon_name               = "aws-ebs-csi-driver"
  addon_version            = data.aws_eks_addon_version.ebs_csi.version
  resolve_conflicts        = "OVERWRITE"
  service_account_role_arn = aws_iam_role.ebs_csi_role.arn

  depends_on = [module.eks.eks_managed_node_groups]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ebs-csi-addon"
    Type = "EKSAddon"
  })
}

# Data sources for addon versions
data "aws_eks_addon_version" "vpc_cni" {
  addon_name         = "vpc-cni"
  kubernetes_version = module.eks.cluster_version
  most_recent        = true
}

data "aws_eks_addon_version" "coredns" {
  addon_name         = "coredns"
  kubernetes_version = module.eks.cluster_version
  most_recent        = true
}

data "aws_eks_addon_version" "kube_proxy" {
  addon_name         = "kube-proxy"
  kubernetes_version = module.eks.cluster_version
  most_recent        = true
}

data "aws_eks_addon_version" "ebs_csi" {
  addon_name         = "aws-ebs-csi-driver"
  kubernetes_version = module.eks.cluster_version
  most_recent        = true
}

# IAM role for VPC CNI addon
resource "aws_iam_role" "vpc_cni_role" {
  name = "${local.name_prefix}-vpc-cni-role"

  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRoleWithWebIdentity"
      Effect = "Allow"
      Principal = {
        Federated = module.eks.oidc_provider_arn
      }
      Condition = {
        StringEquals = {
          "${replace(module.eks.cluster_oidc_issuer_url, "https://", "")}:sub": "system:serviceaccount:kube-system:aws-node"
          "${replace(module.eks.cluster_oidc_issuer_url, "https://", "")}:aud": "sts.amazonaws.com"
        }
      }
    }]
    Version = "2012-10-17"
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vpc-cni-role"
    Type = "IAMRole"
  })
}

resource "aws_iam_role_policy_attachment" "vpc_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.vpc_cni_role.name
}

# IAM role for EBS CSI driver
resource "aws_iam_role" "ebs_csi_role" {
  name = "${local.name_prefix}-ebs-csi-role"

  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRoleWithWebIdentity"
      Effect = "Allow"
      Principal = {
        Federated = module.eks.oidc_provider_arn
      }
      Condition = {
        StringEquals = {
          "${replace(module.eks.cluster_oidc_issuer_url, "https://", "")}:sub": "system:serviceaccount:kube-system:ebs-csi-controller-sa"
          "${replace(module.eks.cluster_oidc_issuer_url, "https://", "")}:aud": "sts.amazonaws.com"
        }
      }
    }]
    Version = "2012-10-17"
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ebs-csi-role"
    Type = "IAMRole"
  })
}

resource "aws_iam_role_policy_attachment" "ebs_csi_policy" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
  role       = aws_iam_role.ebs_csi_role.name
}

# Storage classes
resource "kubernetes_storage_class" "gp3" {
  metadata {
    name = "gp3"
    annotations = {
      "storageclass.kubernetes.io/is-default-class" = "true"
    }
  }

  storage_provisioner    = "ebs.csi.aws.com"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true
  
  parameters = {
    type      = "gp3"
    encrypted = "true"
    kmsKeyId  = aws_kms_key.eks.arn
  }

  depends_on = [aws_eks_addon.ebs_csi_driver]
}

resource "kubernetes_storage_class" "gp3_fast" {
  metadata {
    name = "gp3-fast"
  }

  storage_provisioner    = "ebs.csi.aws.com"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true
  
  parameters = {
    type      = "gp3"
    iops      = "3000"
    throughput = "125"
    encrypted = "true"
    kmsKeyId  = aws_kms_key.eks.arn
  }

  depends_on = [aws_eks_addon.ebs_csi_driver]
}

resource "kubernetes_storage_class" "io2" {
  metadata {
    name = "io2"
  }

  storage_provisioner    = "ebs.csi.aws.com"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true
  
  parameters = {
    type      = "io2"
    iops      = "1000"
    encrypted = "true"
    kmsKeyId  = aws_kms_key.eks.arn
  }

  depends_on = [aws_eks_addon.ebs_csi_driver]
}