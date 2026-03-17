# =============================================================================
# Docker Bake Configuration
#
# Builds webapp, worker, and migration images from a single shared BuildKit
# session, maximising layer reuse across the shared Dockerfile stages
# (pruner, deps, workspace, prod-deps).
#
# Usage (CI):
#   docker buildx bake --file docker-bake.hcl
#
# Build targets:
#   webapp    – Production Next.js server
#   worker    – BullMQ background-job worker
#   migration – One-shot Drizzle migration runner
# =============================================================================

variable "REGISTRY" {
  default = "ghcr.io/umami-creative-gmbh"
}

variable "NEXT_PUBLIC_BUILD_HASH" {
  default = ""
}

group "default" {
  targets = ["webapp", "worker", "migration"]
}

target "webapp" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "webapp"
  args = {
    NEXT_PUBLIC_BUILD_HASH = NEXT_PUBLIC_BUILD_HASH
  }
  outputs = ["type=image,name=${REGISTRY}/z8-webapp,push-by-digest=true,name-canonical=true,push=true"]
}

target "worker" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "worker"
  outputs = ["type=image,name=${REGISTRY}/z8-worker,push-by-digest=true,name-canonical=true,push=true"]
}

target "migration" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "migration"
  outputs = ["type=image,name=${REGISTRY}/z8-migration,push-by-digest=true,name-canonical=true,push=true"]
}
