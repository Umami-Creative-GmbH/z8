#!/usr/bin/env node
/**
 * Documentation Screenshot Capture Script
 *
 * Run this script to capture screenshots for all documentation pages.
 * Prerequisites:
 *   - Dev server running at localhost:3000
 *
 * Usage: bun run scripts/capture-screenshots.js
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const OUTPUT_DIR = path.join(__dirname, '../apps/docs/public/images');

// Path to Chrome executable on Windows
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Pages to capture - grouped by documentation section
const PAGES = {
  'user-guide': [
    { route: '/en/dashboard', name: 'dashboard-page', wait: 25000 },
    { route: '/en/calendar', name: 'calendar-page', wait: 25000 },
    { route: '/en/time-tracking', name: 'time-tracking-page', wait: 25000 },
    { route: '/en/absences', name: 'absences-page', wait: 25000 },
    { route: '/en/approvals', name: 'approvals-page', wait: 25000 },
    { route: '/en/reports', name: 'reports-page', wait: 25000 },
  ],
  'admin-guide': [
    { route: '/en/settings/teams', name: 'teams-page', wait: 25000 },
    { route: '/en/settings/permissions', name: 'permissions-page', wait: 25000 },
    { route: '/en/settings/employees', name: 'employees-page', wait: 25000 },
    { route: '/en/settings/projects', name: 'projects-page', wait: 25000 },
    { route: '/en/settings/locations', name: 'locations-page', wait: 25000 },
    { route: '/en/settings/holidays', name: 'holidays-page', wait: 25000 },
    { route: '/en/settings/vacation', name: 'vacation-page', wait: 25000 },
    { route: '/en/settings/surcharges', name: 'surcharges-page', wait: 25000 },
  ],
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function waitForLogin(page) {
  console.log('\n🔐 Please log in manually in the browser window...');
  console.log('   The script will continue automatically once you reach the dashboard.\n');

  await page.goto(`${BASE_URL}/en/sign-in`, { waitUntil: 'networkidle2' });

  // Wait for navigation away from sign-in page (user logged in)
  while (page.url().includes('sign-in')) {
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('✅ Login detected! Continuing with screenshots...\n');
  await new Promise(r => setTimeout(r, 5000)); // Wait for dashboard to fully load
}

async function captureScreenshot(page, route, outputPath, waitTime) {
  console.log(`Capturing: ${route} -> ${outputPath}`);
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, waitTime));

  await page.screenshot({
    path: outputPath,
    fullPage: false,
    type: 'png'
  });
  console.log(`  ✓ Saved: ${outputPath}`);
}

async function main() {
  console.log('Starting screenshot capture...\n');

  // Ensure output directories exist
  for (const section of Object.keys(PAGES)) {
    ensureDir(path.join(OUTPUT_DIR, section));
  }

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      '--start-maximized',
      '--window-size=1920,1080'
    ]
  });
  console.log('Browser launched!');

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // Wait for manual login
    await waitForLogin(page);

    // Capture all pages
    for (const [section, pages] of Object.entries(PAGES)) {
      console.log(`\nCapturing ${section} screenshots...`);

      for (const { route, name, wait } of pages) {
        const outputPath = path.join(OUTPUT_DIR, section, `${name}.png`);
        await captureScreenshot(page, route, outputPath, wait);
      }
    }

    console.log('\n✅ All screenshots captured successfully!');

  } catch (error) {
    console.error('Error capturing screenshots:', error);
  } finally {
    await browser.close();
  }
}

main();
