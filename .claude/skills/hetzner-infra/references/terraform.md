# Terraform Infrastructure

Infrastructure as Code for Kubernetes clusters using Hetzner Cloud.

## When to Use Terraform

| Use Case | CLI | Terraform |
|----------|-----|-----------|
| One-time setup | Preferred | Overkill |
| Reproducible environments | Manual | Preferred |
| CI/CD integration | Scripts | Preferred |
| Team collaboration | Risky | Preferred |
| State tracking | None | Built-in |
| Drift detection | Manual | Automatic |

## Provider Setup

```hcl
# providers.tf
terraform {
  required_version = ">= 1.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  sensitive   = true
}
```

## Network

```hcl
resource "hcloud_network" "main" {
  name     = "${var.project}-network"
  ip_range = "10.0.0.0/16"
}

resource "hcloud_network_subnet" "main" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.0.0/16"
}
```

## Firewall

```hcl
locals {
  private_net = "10.0.0.0/16"
  vpn_net     = "100.64.0.0/10"
}

resource "hcloud_firewall" "bastion" {
  name = "${var.project}-bastion"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "41641"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_firewall" "masters" {
  name = "${var.project}-masters"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = [local.private_net, local.vpn_net]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "6443"
    source_ips = [local.private_net, local.vpn_net]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "2379-2380"
    source_ips = [local.private_net]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "10250-10252"
    source_ips = [local.private_net, local.vpn_net]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "4240"
    source_ips = [local.private_net]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "8472"
    source_ips = [local.private_net]
  }
}

resource "hcloud_firewall" "workers" {
  name = "${var.project}-workers"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = [local.private_net, local.vpn_net]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "10250"
    source_ips = [local.private_net, local.vpn_net]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "30000-32767"
    source_ips = [local.private_net, local.vpn_net]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "4240"
    source_ips = [local.private_net]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "8472"
    source_ips = [local.private_net]
  }
}
```

## Servers

```hcl
resource "hcloud_placement_group" "masters" {
  count = var.master_count > 1 ? 1 : 0
  name  = "${var.project}-masters"
  type  = "spread"
}

resource "hcloud_server" "bastion" {
  name         = "${var.project}-bastion"
  server_type  = var.bastion_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.admin.id]
  firewall_ids = [hcloud_firewall.bastion.id]

  network {
    network_id = hcloud_network.main.id
    ip         = "10.0.0.1"
  }

  labels = {
    env        = "production"
    role       = "bastion"
    managed-by = "terraform"
  }
}

resource "hcloud_server" "masters" {
  count = var.master_count

  name               = "${var.project}-master-${count.index + 1}"
  server_type        = var.master_type
  image              = "ubuntu-24.04"
  location           = var.location
  ssh_keys           = [hcloud_ssh_key.admin.id]
  firewall_ids       = [hcloud_firewall.masters.id]
  placement_group_id = var.master_count > 1 ? hcloud_placement_group.masters[0].id : null

  network {
    network_id = hcloud_network.main.id
    ip         = "10.0.1.${count.index + 1}"
  }

  labels = {
    env        = "production"
    role       = "master"
    managed-by = "terraform"
  }
}

resource "hcloud_server" "workers" {
  count = var.worker_count

  name         = "${var.project}-worker-${count.index + 1}"
  server_type  = var.worker_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.admin.id]
  firewall_ids = [hcloud_firewall.workers.id]

  network {
    network_id = hcloud_network.main.id
    ip         = "10.0.2.${count.index + 1}"
  }

  labels = {
    env        = "production"
    role       = "worker"
    managed-by = "terraform"
  }
}
```

## Load Balancer

```hcl
resource "hcloud_load_balancer" "main" {
  name               = "${var.project}-lb"
  load_balancer_type = "lb11"
  location           = var.location
}

resource "hcloud_load_balancer_network" "main" {
  load_balancer_id = hcloud_load_balancer.main.id
  network_id       = hcloud_network.main.id
  ip               = "10.0.0.10"
}

resource "hcloud_load_balancer_target" "workers" {
  load_balancer_id = hcloud_load_balancer.main.id
  type             = "label_selector"
  label_selector   = "role=worker"
  use_private_ip   = true
}

resource "hcloud_load_balancer_service" "https" {
  load_balancer_id = hcloud_load_balancer.main.id
  protocol         = "tcp"
  listen_port      = 443
  destination_port = 30443

  health_check {
    protocol = "tcp"
    port     = 30443
    interval = 5
    timeout  = 3
    retries  = 3
  }
}

resource "hcloud_load_balancer_service" "http" {
  load_balancer_id = hcloud_load_balancer.main.id
  protocol         = "tcp"
  listen_port      = 80
  destination_port = 30080
}
```

## Variables

```hcl
variable "project" {
  default = "k8s"
}

variable "location" {
  default = "fsn1"
}

variable "master_count" {
  default = 3
}

variable "worker_count" {
  default = 2
}

variable "bastion_type" {
  default = "cx23"  # 2 vCPU, 4GB RAM
}

variable "master_type" {
  default = "cx23"
}

variable "worker_type" {
  default = "cx33"  # 4 vCPU, 8GB RAM
}
```

## Usage

```bash
terraform init
terraform plan -var="hcloud_token=$HCLOUD_TOKEN"
terraform apply -var="hcloud_token=$HCLOUD_TOKEN"
terraform destroy -var="hcloud_token=$HCLOUD_TOKEN"
```
