#!/usr/bin/env node

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BUSINESSES_DIR = path.join(__dirname, '..', 'public', 'images', 'businesses');
const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 600;
const JPEG_QUALITY = 80;

async function isValidJpeg(filePath) {
  try {
    const buf = fs.readFileSync(filePath, { length: 3 });
    // JPEG magic bytes: FF D8 FF
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  } catch {
    return false;
  }
}

async function isAlreadyOptimized(filePath) {
  try {
    if (!(await isValidJpeg(filePath))) return false;
    const metadata = await sharp(filePath).metadata();
    return metadata.width === TARGET_WIDTH && metadata.height === TARGET_HEIGHT;
  } catch {
    return false;
  }
}

async function optimizeImage(filePath) {
  const filename = path.basename(filePath);
  const statBefore = fs.statSync(filePath);
  const sizeBefore = statBefore.size;

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
    .rotate() // auto-rotate based on EXIF then strip
    .toFile(tmpPath);

  fs.renameSync(tmpPath, filePath);

  const sizeAfter = fs.statSync(filePath).size;
  console.log(
    `Optimized ${filename}: ${Math.round(sizeBefore / 1024)}KB → ${Math.round(sizeAfter / 1024)}KB`
  );
}

async function main() {
  if (!fs.existsSync(BUSINESSES_DIR)) {
    console.error(`Directory not found: ${BUSINESSES_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(BUSINESSES_DIR)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();

  console.log(`Found ${files.length} image files in ${BUSINESSES_DIR}\n`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(BUSINESSES_DIR, file);

    try {
      if (await isAlreadyOptimized(filePath)) {
        console.log(`Skipped ${file}: already 800x600 JPEG`);
        skipped++;
        continue;
      }

      await optimizeImage(filePath);
      processed++;
    } catch (err) {
      console.error(`Error processing ${file}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`);
}

main();
