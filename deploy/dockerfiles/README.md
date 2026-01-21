# Dockerfiles

This directory will contain Dockerfiles for containerizing Z8 applications.

## Planned

- `webapp.Dockerfile` - Next.js web application container
- `worker.Dockerfile` - Background job worker (if separated)

## Usage

Once implemented, build images with:

```bash
docker build -f deploy/dockerfiles/webapp.Dockerfile -t z8-webapp .
```
