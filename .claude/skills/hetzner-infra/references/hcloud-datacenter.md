# hcloud datacenter/location/iso

Datacenter, location, and ISO management for Hetzner Cloud.

## Locations

```bash
# List locations
hcloud location list
```

| Location | City | Country | Network Zone |
|----------|------|---------|--------------|
| fsn1 | Falkenstein | Germany | eu-central |
| nbg1 | Nuremberg | Germany | eu-central |
| hel1 | Helsinki | Finland | eu-central |
| ash | Ashburn | USA | us-east |
| hil | Hillsboro | USA | us-west |
| sin | Singapore | Singapore | ap-southeast |

## Datacenters

```bash
# List datacenters
hcloud datacenter list
```

| Datacenter | Location |
|------------|----------|
| fsn1-dc14 | Falkenstein |
| nbg1-dc3 | Nuremberg |
| hel1-dc2 | Helsinki |
| ash-dc1 | Ashburn |
| hil-dc1 | Hillsboro |
| sin-dc1 | Singapore |

## ISOs

```bash
# List available ISOs
hcloud iso list

# Describe ISO
hcloud iso describe debian-12.0.0-amd64-netinst.iso
```

## Attach ISO to Server

```bash
# Attach ISO
hcloud server attach-iso k8s-server debian-12.0.0-amd64-netinst.iso

# Detach ISO
hcloud server detach-iso k8s-server
```

## Location Selection

### EU (GDPR Compliant)
- **fsn1** - Best connectivity, largest
- **nbg1** - Good alternative
- **hel1** - Nordic location

### Americas
- **ash** - US East Coast
- **hil** - US West Coast

### Asia-Pacific
- **sin** - Singapore

## Recommendations

1. **Single location** - Simplest, lowest latency
2. **Multi-location** - Disaster recovery
3. **Same network zone** - Private networking works within zone

## Network Zones

| Zone | Locations |
|------|-----------|
| eu-central | fsn1, nbg1, hel1 |
| us-east | ash |
| us-west | hil |
| ap-southeast | sin |

Private networks can span all locations within a zone.
