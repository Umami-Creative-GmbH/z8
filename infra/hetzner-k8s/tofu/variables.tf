variable "hcloud_token" {
  type        = string
  sensitive   = true
  description = "Hetzner Cloud API token (Read & Write)."
}

variable "ssh_public_key_path" {
  type        = string
  description = "Path to the SSH public key to install on nodes."
}

variable "ssh_private_key_path" {
  type        = string
  default     = ""
  description = "Optional path to the SSH private key (leave empty to use ssh-agent)."
}

variable "cluster_name" {
  type        = string
  default     = "z8"
  description = "Cluster name (used for node naming and kubeconfig)."
}

variable "network_region" {
  type        = string
  default     = "eu-central"
  description = "Hetzner network region (eu-central or us-east)."
}

variable "control_plane_location" {
  type        = string
  default     = "nbg1"
  description = "Hetzner location for control plane nodes."
}

variable "worker_location" {
  type        = string
  default     = "nbg1"
  description = "Hetzner location for worker nodes."
}

variable "control_plane_server_type" {
  type        = string
  default     = "cx23"
  description = "Hetzner server type for control plane nodes."
}

variable "worker_server_type" {
  type        = string
  default     = "cx23"
  description = "Hetzner server type for worker nodes."
}

variable "load_balancer_type" {
  type        = string
  default     = "lb11"
  description = "Hetzner load balancer type for the ingress controller."
}

variable "load_balancer_location" {
  type        = string
  default     = "nbg1"
  description = "Hetzner load balancer location."
}

variable "firewall_ssh_source" {
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
  description = "CIDR ranges allowed to SSH into nodes. Restrict in production."
}

variable "firewall_kube_api_source" {
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
  description = "CIDR ranges allowed to access the Kubernetes API. Restrict in production."
}
