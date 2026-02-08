#!/usr/bin/env node

/**
 * Download images for Liberty Village site
 * - Uses Unsplash API for most images (free, high quality)
 * - Downloads based on business names, categories, and descriptions
 * - Saves to appropriate directories in public/images/
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Unsplash API - using public demo API (limited to 50 requests/hour)
// For production, get a free API key at https://unsplash.com/developers
const UNSPLASH_ACCESS_KEY = 'demo'; // Replace with your API key for higher limits

const dataDir = path.join(__dirname, '../data');
const imagesDir = path.join(__dirname, '../public/images');

// Helper to download image from URL
async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

// Helper to search Unsplash
async function searchUnsplash(query, orientation = 'landscape') {
  return new Promise((resolve, reject) => {
    // Using source.unsplash.com which doesn't require API key for basic usage
    // Format: https://source.unsplash.com/{width}x{height}/?{query}
    const width = orientation === 'landscape' ? 800 : 400;
    const height = orientation === 'landscape' ? 450 : 225;

    // Direct download URL (no API key needed)
    const url = `https://source.unsplash.com/${width}x${height}/?${encodeURIComponent(query)}`;
    resolve(url);
  });
}

// Generate search query based on item data
function generateSearchQuery(item, type) {
  switch(type) {
    case 'business':
      // Use category + subcategory for better results
      const category = item.category?.replace(/-/g, ' ') || '';
      const subcategory = item.subcategory || '';
      // For specific businesses, use generic terms
      if (category.includes('restaurant')) return 'restaurant interior food';
      if (category.includes('coffee')) return 'coffee shop cafe';
      if (category.includes('gym')) return 'fitness gym';
      if (category.includes('salon')) return 'hair salon beauty';
      if (category.includes('bar')) return 'bar cocktails';
      return subcategory || category || 'toronto business';

    case 'service':
      // Use the service name
      const serviceName = item.name?.toLowerCase() || '';
      if (serviceName.includes('restaurant')) return 'restaurant dining';
      if (serviceName.includes('coffee')) return 'coffee espresso';
      if (serviceName.includes('gym')) return 'gym fitness';
      if (serviceName.includes('yoga')) return 'yoga studio';
      if (serviceName.includes('park')) return 'urban park toronto';
      if (serviceName.includes('grocery')) return 'grocery store fresh';
      if (serviceName.includes('bar')) return 'bar nightlife';
      if (serviceName.includes('pet')) return 'pet care dog';
      return serviceName || 'toronto';

    case 'guide':
      // Use guide topic
      const guideName = item.slug?.replace(/-/g, ' ') || '';
      if (guideName.includes('parking')) return 'parking garage toronto';
      if (guideName.includes('traffic')) return 'toronto traffic street';
      if (guideName.includes('moving')) return 'moving boxes apartment';
      if (guideName.includes('noise')) return 'urban apartment building';
      if (guideName.includes('internet')) return 'internet wifi router';
      if (guideName.includes('recycling')) return 'recycling bins waste';
      if (guideName.includes('transit')) return 'toronto ttc streetcar';
      return guideName || 'toronto guide';

    case 'neighborhood':
      // Use neighborhood names
      return 'toronto neighborhood street urban';

    default:
      return 'toronto';
  }
}

async function processItems(items, type, imageSubdir) {
  console.log(`\n📥 Processing ${items.length} ${type} images...`);

  const outputDir = path.join(imagesDir, imageSubdir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    const imagePath = item.image?.replace('/images/', '') || '';
    if (!imagePath) continue;

    const filename = path.basename(imagePath);
    const filepath = path.join(imagesDir, imagePath.replace('/images/', ''));

    // Skip if already exists and is larger than placeholder (>5KB)
    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath);
      if (stats.size > 5000) {
        console.log(`⏭️  Skipping ${filename} (already exists)`);
        skipped++;
        continue;
      }
    }

    try {
      const query = generateSearchQuery(item, type);
      console.log(`🔍 Downloading ${filename}: "${query}"`);

      const imageUrl = await searchUnsplash(query, type === 'business' ? 'landscape' : 'landscape');
      await downloadImage(imageUrl, filepath);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

      downloaded++;
      console.log(`✅ Downloaded ${filename}`);
    } catch (error) {
      console.error(`❌ Failed to download ${filename}:`, error.message);
      failed++;
    }
  }

  console.log(`\n${type} summary: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`);
}

async function main() {
  console.log('🚀 Starting image download process...\n');

  // Read JSON files
  const businesses = JSON.parse(fs.readFileSync(path.join(dataDir, 'businesses.json'), 'utf8'));
  const services = JSON.parse(fs.readFileSync(path.join(dataDir, 'services.json'), 'utf8'));
  const topics = JSON.parse(fs.readFileSync(path.join(dataDir, 'topics.json'), 'utf8'));
  const neighborhoods = JSON.parse(fs.readFileSync(path.join(dataDir, 'neighborhoods.json'), 'utf8'));

  // Process each category
  await processItems(businesses, 'business', 'businesses');
  await processItems(services, 'service', 'services');
  await processItems(topics, 'guide', 'guides');
  await processItems(neighborhoods, 'neighborhood', 'neighborhoods');

  console.log('\n✨ Image download complete!');
  console.log('\n💡 Note: Some images may need manual replacement or Glif generation for Liberty Village-specific content.');
}

main().catch(console.error);
