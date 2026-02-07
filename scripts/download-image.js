#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = require('sharp');

const BUSINESSES_DIR = path.join(__dirname, '..', 'public', 'images', 'businesses');
const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 600;
const JPEG_QUALITY = 80;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Magic bytes for image formats
const IMAGE_SIGNATURES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  webp_riff: [0x52, 0x49, 0x46, 0x46], // RIFF header (WebP starts with RIFF)
};

function isImageFile(filePath) {
  try {
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);

    if (buf[0] === IMAGE_SIGNATURES.jpeg[0] && buf[1] === IMAGE_SIGNATURES.jpeg[1] && buf[2] === IMAGE_SIGNATURES.jpeg[2]) return 'jpeg';
    if (buf[0] === IMAGE_SIGNATURES.png[0] && buf[1] === IMAGE_SIGNATURES.png[1] && buf[2] === IMAGE_SIGNATURES.png[2] && buf[3] === IMAGE_SIGNATURES.png[3]) return 'png';
    if (buf[0] === IMAGE_SIGNATURES.webp_riff[0] && buf[1] === IMAGE_SIGNATURES.webp_riff[1] && buf[2] === IMAGE_SIGNATURES.webp_riff[2] && buf[3] === IMAGE_SIGNATURES.webp_riff[3] && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';

    return null;
  } catch {
    return null;
  }
}

function downloadFile(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      return reject(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
    }

    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: { 'User-Agent': USER_AGENT },
    };

    protocol.get(url, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        return downloadFile(redirectUrl, destPath, redirectCount + 1).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      const file = fs.createWriteStream(destPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function optimizeImage(filePath) {
  const tmpPath = filePath + '.tmp';
  await sharp(filePath)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, {
      fit: 'cover',
      position: 'centre',
    })
    .jpeg({
      quality: JPEG_QUALITY,
      progressive: true,
    })
    .rotate()
    .toFile(tmpPath);

  fs.renameSync(tmpPath, filePath);
}

async function downloadAndProcess(url, slug) {
  const destPath = path.join(BUSINESSES_DIR, `${slug}.jpg`);

  // Ensure directory exists
  if (!fs.existsSync(BUSINESSES_DIR)) {
    fs.mkdirSync(BUSINESSES_DIR, { recursive: true });
  }

  console.log(`Downloading ${slug} from ${url}...`);

  try {
    await downloadFile(url, destPath);
  } catch (err) {
    console.error(`  FAILED to download ${slug}: ${err.message}`);
    return false;
  }

  // Validate it's a real image
  const imageType = isImageFile(destPath);
  if (!imageType) {
    console.error(`  FAILED: ${slug}.jpg is not a valid image (likely HTML). Deleting.`);
    fs.unlinkSync(destPath);
    return false;
  }

  console.log(`  Downloaded ${slug}.jpg (detected: ${imageType})`);

  // Optimize with sharp
  try {
    const sizeBefore = fs.statSync(destPath).size;
    await optimizeImage(destPath);
    const sizeAfter = fs.statSync(destPath).size;
    console.log(`  Optimized: ${Math.round(sizeBefore / 1024)}KB -> ${Math.round(sizeAfter / 1024)}KB (800x600 progressive JPEG)`);
  } catch (err) {
    console.error(`  FAILED to optimize ${slug}: ${err.message}`);
    fs.unlinkSync(destPath);
    return false;
  }

  return true;
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && i + 1 < args.length) {
      result.url = args[++i];
    } else if (args[i] === '--slug' && i + 1 < args.length) {
      result.slug = args[++i];
    } else if (args[i] === '--batch' && i + 1 < args.length) {
      result.batch = args[++i];
    }
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.batch) {
    // Batch mode: read JSON file with array of {url, slug}
    if (!fs.existsSync(opts.batch)) {
      console.error(`Batch file not found: ${opts.batch}`);
      process.exit(1);
    }

    const items = JSON.parse(fs.readFileSync(opts.batch, 'utf8'));
    if (!Array.isArray(items)) {
      console.error('Batch file must contain a JSON array of {url, slug} objects');
      process.exit(1);
    }

    console.log(`Processing batch of ${items.length} images...\n`);
    let success = 0;
    let failed = 0;

    for (const item of items) {
      if (!item.url || !item.slug) {
        console.error(`Skipping invalid entry (missing url or slug): ${JSON.stringify(item)}`);
        failed++;
        continue;
      }
      const ok = await downloadAndProcess(item.url, item.slug);
      if (ok) success++;
      else failed++;
      console.log('');
    }

    console.log(`\nBatch complete: ${success} succeeded, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);

  } else if (opts.url && opts.slug) {
    // Single mode
    const ok = await downloadAndProcess(opts.url, opts.slug);
    process.exit(ok ? 0 : 1);

  } else {
    console.error('Usage:');
    console.error('  node download-image.js --url <image_url> --slug <business_slug>');
    console.error('  node download-image.js --batch <json_file>');
    console.error('');
    console.error('Single mode: Downloads image from URL and saves as public/images/businesses/{slug}.jpg');
    console.error('Batch mode:  JSON file should contain array of {url, slug} objects');
    process.exit(1);
  }
}

main();
