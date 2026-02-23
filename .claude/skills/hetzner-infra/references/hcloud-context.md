# hcloud context/config

Context and configuration management for hcloud CLI.

## Contexts

Contexts allow managing multiple Hetzner Cloud projects.

### List Contexts

```bash
hcloud context list
```

### Create Context

```bash
# Interactive (prompts for token)
hcloud context create my-project

# With token
hcloud context create my-project
# Enter token when prompted
```

### Switch Context

```bash
hcloud context use my-project
```

### Delete Context

```bash
hcloud context delete my-project
```

### Active Context

```bash
# Show active context
hcloud context active
```

## Configuration

### Config Location

```
~/.config/hcloud/cli.toml
```

### Environment Variables

```bash
# API token (overrides context)
export HCLOUD_TOKEN="your-token-here"

# Debug mode
export HCLOUD_DEBUG=1

# Custom endpoint (for testing)
export HCLOUD_ENDPOINT="https://api.hetzner.cloud/v1"
```

### Config File Example

```toml
active_context = "production"

[contexts.production]
token = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[contexts.staging]
token = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
```

## Token Management

### Generate Token

1. Go to https://console.hetzner.cloud
2. Select project
3. Security → API Tokens
4. Generate API Token
5. Select Read & Write permissions

### Token Security

```bash
# Store in environment variable (recommended)
export HCLOUD_TOKEN="your-token"

# Or use context (stored in config file)
hcloud context create production
```

## Shell Completion

```bash
# Bash
hcloud completion bash > /etc/bash_completion.d/hcloud

# Zsh
hcloud completion zsh > "${fpath[1]}/_hcloud"

# Fish
hcloud completion fish > ~/.config/fish/completions/hcloud.fish
```

## Version

```bash
hcloud version
```

## Best Practices

1. **Use contexts** - Separate production/staging
2. **Don't commit tokens** - Use environment variables
3. **Rotate tokens** - Regularly regenerate
4. **Least privilege** - Read-only tokens where possible
