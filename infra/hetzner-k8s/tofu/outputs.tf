output "kubeconfig" {
  value     = module.kube-hetzner.kubeconfig
  sensitive = true
}
