#!/usr/bin/env node

/**
 * Parallel image downloader for Liberty Village site
 * Downloads images using multiple concurrent workers for speed
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { Worker } = require('worker_threads');

const dataDir = path.join(__dirname, '../data');
const imagesDir = path.join(__dirname, '../public/images');

// Configuration
const MAX_CONCURRENT = 50; // Number of parallel downloads
const DELAY_MS = 100; // Small delay between requests to avoid rate limiting

// Helper to download image from URL
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, (response) => {
      // Follow redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadImage(response.headers.location, filepath)
          .then(resolve)
          .catch(reject);
      }

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

// Generate Unsplash URL
function getUnsplashUrl(query, width = 800, height = 450) {
  return `https://source.unsplash.com/${width}x${height}/?${encodeURIComponent(query)}`;
}

// Generate search query based on item data
function generateSearchQuery(item, type) {
  switch(type) {
    case 'business':
      const category = item.category?.replace(/-/g, ' ') || '';
      if (category.includes('restaurant')) return 'restaurant interior food';
      if (category.includes('italian')) return 'italian restaurant pasta';
      if (category.includes('coffee')) return 'coffee shop cafe latte';
      if (category.includes('gym')) return 'fitness gym workout';
      if (category.includes('salon') || category.includes('barber')) return 'hair salon barbershop';
      if (category.includes('bar') || category.includes('pub')) return 'bar pub drinks';
      if (category.includes('yoga')) return 'yoga studio class';
      if (category.includes('pet') || category.includes('vet')) return 'veterinary pet care';
      if (category.includes('dental')) return 'dental clinic modern';
      if (category.includes('coworking')) return 'coworking space office';
      if (category.includes('grocery')) return 'grocery store produce';
      if (category.includes('pharmacy')) return 'pharmacy drugstore';
      return 'modern business storefront';

    case 'service':
      const serviceName = item.slug?.replace(/-/g, ' ') || '';
      if (serviceName.includes('restaurant')) return 'fine dining restaurant';
      if (serviceName.includes('coffee')) return 'coffee espresso barista';
      if (serviceName.includes('gym')) return 'modern gym fitness';
      if (serviceName.includes('yoga')) return 'yoga practice meditation';
      if (serviceName.includes('park')) return 'urban park toronto green space';
      if (serviceName.includes('grocery')) return 'fresh produce grocery';
      if (serviceName.includes('bar')) return 'bar nightlife cocktails';
      if (serviceName.includes('pet')) return 'happy dog pet';
      if (serviceName.includes('brunch')) return 'brunch breakfast food';
      if (serviceName.includes('pizza')) return 'pizza oven slice';
      if (serviceName.includes('patio')) return 'outdoor patio dining';
      return 'toronto urban lifestyle';

    case 'guide':
      const guideName = item.slug?.replace(/-/g, ' ') || '';
      if (guideName.includes('parking')) return 'parking garage urban';
      if (guideName.includes('traffic')) return 'toronto traffic downtown';
      if (guideName.includes('moving')) return 'moving truck boxes';
      if (guideName.includes('noise')) return 'apartment building urban';
      if (guideName.includes('internet')) return 'wifi router internet';
      if (guideName.includes('recycling')) return 'recycling bins green';
      if (guideName.includes('transit') || guideName.includes('ttc')) return 'toronto streetcar transit';
      if (guideName.includes('bike')) return 'bike lane cycling toronto';
      if (guideName.includes('walk')) return 'toronto sidewalk pedestrian';
      if (guideName.includes('where to stay')) return 'toronto hotel accommodation';
      return 'toronto city guide';

    case 'neighborhood':
      return 'toronto neighborhood architecture urban';

    default:
      return 'toronto urban';
  }
}

// Process a single item
async function processItem(item, type, imageSubdir) {
  const imagePath = item.image?.replace('/images/', '') || '';
  if (!imagePath) return { status: 'skip', reason: 'no image path' };

  const filename = path.basename(imagePath);
  const filepath = path.join(imagesDir, imagePath.replace('/images/', ''));

  // Create directory if needed
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Skip if already exists and is larger than placeholder (>5KB)
  if (fs.existsSync(filepath)) {
    const stats = fs.statSync(filepath);
    if (stats.size > 5000) {
      return { status: 'skip', reason: 'already exists', filename };
    }
  }

  try {
    const query = generateSearchQuery(item, type);
    const imageUrl = getUnsplashUrl(query);

    await downloadImage(imageUrl, filepath);

    return { status: 'success', filename, query };
  } catch (error) {
    return { status: 'error', filename, error: error.message };
  }
}

// Queue processor with concurrency limit
async function processQueue(items, type, imageSubdir, concurrency = MAX_CONCURRENT) {
  const results = {
    success: 0,
    skip: 0,
    error: 0,
    total: items.length
  };

  const queue = [...items];
  const active = new Set();

  async function processNext() {
    if (queue.length === 0) return;

    const item = queue.shift();
    const promise = (async () => {
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));

      const result = await processItem(item, type, imageSubdir);

      if (result.status === 'success') {
        results.success++;
        console.log(`✅ [${results.success}/${results.total}] ${result.filename}: "${result.query}"`);
      } else if (result.status === 'skip') {
        results.skip++;
        console.log(`⏭️  [${results.skip}] ${result.filename} (${result.reason})`);
      } else if (result.status === 'error') {
        results.error++;
        console.error(`❌ ${result.filename}: ${result.error}`);
      }

      active.delete(promise);

      // Process next item
      if (queue.length > 0) {
        await processNext();
      }
    })();

    active.add(promise);
    await promise;
  }

  // Start initial batch of concurrent downloads
  const initialBatch = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: initialBatch }, () => processNext())
  );

  // Wait for all active promises to complete
  await Promise.all(Array.from(active));

  return results;
}

async function main() {
  console.log(`🚀 Starting parallel image download with ${MAX_CONCURRENT} concurrent workers...\n`);

  const startTime = Date.now();

  // Read JSON files
  const businesses = JSON.parse(fs.readFileSync(path.join(dataDir, 'businesses.json'), 'utf8'));
  const services = JSON.parse(fs.readFileSync(path.join(dataDir, 'services.json'), 'utf8'));
  const topics = JSON.parse(fs.readFileSync(path.join(dataDir, 'topics.json'), 'utf8'));
  const neighborhoods = JSON.parse(fs.readFileSync(path.join(dataDir, 'neighborhoods.json'), 'utf8'));

  // Process each category
  console.log(`📥 Processing ${businesses.length} businesses...`);
  const bizResults = await processQueue(businesses, 'business', 'businesses');
  console.log(`\nBusinesses: ${bizResults.success} downloaded, ${bizResults.skip} skipped, ${bizResults.error} failed\n`);

  console.log(`📥 Processing ${services.length} services...`);
  const svcResults = await processQueue(services, 'service', 'services');
  console.log(`\nServices: ${svcResults.success} downloaded, ${svcResults.skip} skipped, ${svcResults.error} failed\n`);

  console.log(`📥 Processing ${topics.length} guides...`);
  const guideResults = await processQueue(topics, 'guide', 'guides');
  console.log(`\nGuides: ${guideResults.success} downloaded, ${guideResults.skip} skipped, ${guideResults.error} failed\n`);

  console.log(`📥 Processing ${neighborhoods.length} neighborhoods...`);
  const nbrResults = await processQueue(neighborhoods, 'neighborhood', 'neighborhoods');
  console.log(`\nNeighborhoods: ${nbrResults.success} downloaded, ${nbrResults.skip} skipped, ${nbrResults.error} failed\n`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalSuccess = bizResults.success + svcResults.success + guideResults.success + nbrResults.success;
  const totalSkip = bizResults.skip + svcResults.skip + guideResults.skip + nbrResults.skip;
  const totalError = bizResults.error + svcResults.error + guideResults.error + nbrResults.error;

  console.log(`\n✨ Complete in ${elapsed}s!`);
  console.log(`📊 Total: ${totalSuccess} downloaded, ${totalSkip} skipped, ${totalError} failed`);
  console.log(`\n💡 Next: Use Glif to generate Liberty Village-specific images for neighborhood comparisons.`);
}

main().catch(console.error);
