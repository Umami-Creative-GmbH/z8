terraform {
  required_version = ">= 1.10.1"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.51.0"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

module "kube-hetzner" {
  source  = "kube-hetzner/kube-hetzner/hcloud"
  version = "2.19.1"

  providers = {
    hcloud = hcloud
  }

  hcloud_token = var.hcloud_token

  ssh_public_key  = file(var.ssh_public_key_path)
  ssh_private_key = var.ssh_private_key_path == "" ? null : file(var.ssh_private_key_path)

  network_region = var.network_region

  cluster_name = var.cluster_name

  control_plane_nodepools = [
    {
      name        = "control-plane"
      server_type = var.control_plane_server_type
      location    = var.control_plane_location
      labels      = []
      taints      = []
      count       = 3
    }
  ]

  agent_nodepools = [
    {
      name        = "worker"
      server_type = var.worker_server_type
      location    = var.worker_location
      labels      = []
      taints      = []
      count       = 2
    }
  ]

  # Private-only nodes behind a dedicated NAT/bastion router.
  # kube-hetzner automatically disables public interfaces on control plane and workers when nat_router is enabled.
  nat_router = {
    server_type = var.nat_router_server_type
    location    = var.nat_router_location
    enable_sudo = true
  }

  # Keep only the ingress LB public; Kubernetes API is reached via NAT router port-forwarding.
  control_plane_lb_enable_public_interface = false

  ingress_controller   = "traefik"
  enable_cert_manager  = false
  restrict_outbound_traffic = false

  use_control_plane_lb = true
  load_balancer_type   = var.load_balancer_type
  load_balancer_location = var.load_balancer_location

  firewall_ssh_source      = var.firewall_ssh_source
  firewall_kube_api_source = var.firewall_kube_api_source
}
