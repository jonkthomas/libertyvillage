#!/usr/bin/env node

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BUSINESSES_DIR = path.join(__dirname, '..', 'public', 'images', 'businesses');
const DATA_FILE = path.join(__dirname, '..', 'data', 'businesses.json');

async function validate() {
  const businesses = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const expectedSlugs = new Set(businesses.map(b => b.slug));
  const files = fs.readdirSync(BUSINESSES_DIR).filter(f => f.endsWith('.jpg'));
  const actualSlugs = new Set(files.map(f => f.replace('.jpg', '')));

  let pass = 0;
  let fail = 0;
  const failures = [];

  // Check each file is a valid JPEG at correct dimensions
  for (const file of files) {
    const filePath = path.join(BUSINESSES_DIR, file);
    const slug = file.replace('.jpg', '');
    try {
      const meta = await sharp(filePath).metadata();
      const stat = fs.statSync(filePath);
      const sizeKB = stat.size / 1024;
      const issues = [];

      if (meta.format !== 'jpeg') issues.push(`format=${meta.format}, expected jpeg`);
      if (Math.abs(meta.width - 800) > 40) issues.push(`width=${meta.width}, expected ~800`);
      if (Math.abs(meta.height - 600) > 30) issues.push(`height=${meta.height}, expected ~600`);
      if (sizeKB < 10) issues.push(`too small: ${sizeKB.toFixed(0)}KB`);
      if (sizeKB > 200) issues.push(`too large: ${sizeKB.toFixed(0)}KB`);

      if (issues.length > 0) {
        fail++;
        failures.push(`FAIL ${slug}: ${issues.join(', ')}`);
      } else {
        pass++;
      }
    } catch (err) {
      fail++;
      failures.push(`FAIL ${slug}: ${err.message}`);
    }
  }

  // Check for missing images (in JSON but no file)
  for (const slug of expectedSlugs) {
    if (!actualSlugs.has(slug)) {
      fail++;
      failures.push(`MISSING ${slug}: referenced in businesses.json but no image file`);
    }
  }

  // Check for orphan images (file exists but not in JSON)
  for (const slug of actualSlugs) {
    if (!expectedSlugs.has(slug)) {
      failures.push(`ORPHAN ${slug}: image file exists but not in businesses.json`);
    }
  }

  console.log(`\n=== Image Validation Report ===`);
  console.log(`Total files: ${files.length}`);
  console.log(`Expected (from JSON): ${expectedSlugs.size}`);
  console.log(`Pass: ${pass}`);
  console.log(`Fail: ${fail}`);

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  ${f}`));
  } else {
    console.log(`\nAll images valid!`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

validate().catch(err => {
  console.error('Validation error:', err);
  process.exit(1);
});
