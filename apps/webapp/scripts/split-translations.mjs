#!/usr/bin/env node
/**
 * Migration script to split monolithic translation files into namespaces
 *
 * Namespace mapping:
 * - common: common, generic, nav, header, user, table, validation, errors, info, meta
 * - auth: auth, profile, sessions
 * - dashboard: dashboard
 * - calendar: absences, calendar
 * - timeTracking: timeTracking, wellness
 * - reports: reports
 * - settings: settings, organization, vacation, team
 * - onboarding: onboarding
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MESSAGES_DIR = path.join(__dirname, '..', 'messages');
const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pt'];

// Namespace mapping: namespace -> array of top-level key prefixes
const NAMESPACE_MAP = {
  common: ['common', 'generic', 'nav', 'header', 'user', 'table', 'validation', 'errors', 'info', 'meta'],
  auth: ['auth', 'profile', 'sessions'],
  dashboard: ['dashboard'],
  calendar: ['absences', 'calendar'],
  timeTracking: ['timeTracking', 'wellness'],
  reports: ['reports'],
  settings: ['settings', 'organization', 'vacation', 'team'],
  onboarding: ['onboarding'],
};

// All namespaces
const ALL_NAMESPACES = Object.keys(NAMESPACE_MAP);

// Build reverse lookup: prefix -> namespace
const PREFIX_TO_NAMESPACE = {};
for (const [namespace, prefixes] of Object.entries(NAMESPACE_MAP)) {
  for (const prefix of prefixes) {
    PREFIX_TO_NAMESPACE[prefix] = namespace;
  }
}

/**
 * Determine which namespace a top-level key belongs to
 */
function getNamespaceForKey(key) {
  return PREFIX_TO_NAMESPACE[key] || 'common';
}

/**
 * Split a flat translation object into namespaces
 */
function splitIntoNamespaces(translations) {
  const namespaced = {};

  // Initialize all namespaces
  for (const ns of ALL_NAMESPACES) {
    namespaced[ns] = {};
  }

  // Split by top-level keys
  for (const [key, value] of Object.entries(translations)) {
    const namespace = getNamespaceForKey(key);
    namespaced[namespace][key] = value;
  }

  return namespaced;
}

/**
 * Count keys recursively in a nested object
 */
function countKeys(obj) {
  let count = 0;
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      count += countKeys(value);
    } else {
      count += 1;
    }
  }
  return count;
}

/**
 * Get file size in KB
 */
function getFileSizeKB(filePath) {
  const stats = fs.statSync(filePath);
  return (stats.size / 1024).toFixed(2);
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('=== Tolgee Namespace Migration ===\n');

  // Ensure namespace directories exist
  for (const ns of ALL_NAMESPACES) {
    const nsDir = path.join(MESSAGES_DIR, ns);
    if (!fs.existsSync(nsDir)) {
      fs.mkdirSync(nsDir, { recursive: true });
      console.log(`Created directory: messages/${ns}/`);
    }
  }

  console.log('\n--- Processing languages ---\n');

  const stats = {
    before: {},
    after: {},
  };

  for (const lang of LANGUAGES) {
    const srcFile = path.join(MESSAGES_DIR, `${lang}.json`);

    if (!fs.existsSync(srcFile)) {
      console.warn(`Warning: ${lang}.json not found, skipping...`);
      continue;
    }

    // Read source file
    const content = fs.readFileSync(srcFile, 'utf-8');
    const translations = JSON.parse(content);

    // Record before stats
    const beforeSize = getFileSizeKB(srcFile);
    const beforeKeys = countKeys(translations);
    stats.before[lang] = { size: beforeSize, keys: beforeKeys };

    console.log(`Processing ${lang}.json (${beforeSize} KB, ${beforeKeys} keys)`);

    // Split into namespaces
    const namespaced = splitIntoNamespaces(translations);

    // Write namespace files
    let totalAfterSize = 0;
    const namespaceSizes = {};

    for (const [ns, data] of Object.entries(namespaced)) {
      const nsFile = path.join(MESSAGES_DIR, ns, `${lang}.json`);
      const keyCount = countKeys(data);

      if (keyCount > 0) {
        // Write with pretty formatting
        fs.writeFileSync(nsFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        const nsSize = getFileSizeKB(nsFile);
        totalAfterSize += parseFloat(nsSize);
        namespaceSizes[ns] = { size: nsSize, keys: keyCount };
        console.log(`  -> ${ns}/${lang}.json (${nsSize} KB, ${keyCount} keys)`);
      } else {
        // Still write empty object for consistency
        fs.writeFileSync(nsFile, '{}\n', 'utf-8');
        namespaceSizes[ns] = { size: '0.00', keys: 0 };
      }
    }

    stats.after[lang] = {
      totalSize: totalAfterSize.toFixed(2),
      namespaces: namespaceSizes
    };

    console.log('');
  }

  // Print summary
  console.log('\n=== Migration Summary ===\n');

  for (const lang of LANGUAGES) {
    if (stats.before[lang]) {
      const before = stats.before[lang];
      const after = stats.after[lang];
      console.log(`${lang}: ${before.size} KB -> ${after.totalSize} KB total (across ${ALL_NAMESPACES.length} namespaces)`);
    }
  }

  // Print namespace breakdown for en
  if (stats.after.en) {
    console.log('\n--- Namespace breakdown (en) ---\n');
    for (const [ns, data] of Object.entries(stats.after.en.namespaces)) {
      console.log(`  ${ns}: ${data.size} KB (${data.keys} keys)`);
    }
  }

  console.log('\n--- Expected load reduction ---\n');
  console.log('Initial page load will only fetch "common" namespace.');
  console.log('Route-specific namespaces loaded on demand.\n');

  const commonSize = parseFloat(stats.after.en?.namespaces?.common?.size || 0);
  const totalSize = parseFloat(stats.before.en?.size || 0);
  const reduction = ((totalSize - commonSize) / totalSize * 100).toFixed(1);

  console.log(`Common namespace: ~${commonSize} KB (loaded on all pages)`);
  console.log(`Estimated initial load reduction: ~${reduction}%`);

  console.log('\n=== Migration Complete ===\n');
  console.log('Next steps:');
  console.log('1. Update tolgee.config.cjs for namespace support');
  console.log('2. Update src/tolgee/shared.ts with namespace loaders');
  console.log('3. Update src/tolgee/client.tsx for namespace support');
  console.log('4. Update tolgee-extractor.mjs for namespace inference');
  console.log('5. Update layouts to load route-specific namespaces');
  console.log('6. Run: pnpm dlx @tolgee/cli sync');
}

migrate().catch(console.error);
