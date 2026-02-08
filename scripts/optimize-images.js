const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PUBLIC_IMAGES = path.join(__dirname, '..', 'public', 'images');

async function optimizeDir(dir, maxWidth, maxSizeKB) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    try {
      const metadata = await sharp(filePath).metadata();

      if (metadata.width > maxWidth || stat.size > maxSizeKB * 1024) {
        await sharp(filePath)
          .resize(maxWidth, null, { withoutEnlargement: true })
          .jpeg({ quality: 80, progressive: true })
          .toFile(filePath + '.tmp');

        fs.renameSync(filePath + '.tmp', filePath);
        const newStat = fs.statSync(filePath);
        console.log(`Optimized ${file}: ${Math.round(stat.size/1024)}KB → ${Math.round(newStat.size/1024)}KB`);
      }
    } catch (e) {
      console.log(`Skipped ${file}: ${e.message}`);
    }
  }
}

async function main() {
  console.log('Optimizing images...');

  // Hero images: max 800px wide, 150KB
  await optimizeDir(path.join(PUBLIC_IMAGES, 'neighborhood'), 800, 150);
  await optimizeDir(path.join(PUBLIC_IMAGES, 'services'), 800, 150);
  await optimizeDir(path.join(PUBLIC_IMAGES, 'guides'), 800, 150);
  await optimizeDir(path.join(PUBLIC_IMAGES, 'neighborhoods'), 800, 150);

  // Business thumbnails: max 400px wide, 80KB
  await optimizeDir(path.join(PUBLIC_IMAGES, 'businesses'), 400, 80);

  // OG images: keep at 1200px, 200KB
  await optimizeDir(path.join(PUBLIC_IMAGES, 'og'), 1200, 200);

  // Report total size
  let totalSize = 0;
  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(fullPath);
      else totalSize += fs.statSync(fullPath).size;
    }
  }
  walkDir(PUBLIC_IMAGES);
  console.log(`\nTotal images size: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
}

main();
