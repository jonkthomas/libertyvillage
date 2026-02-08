const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BUSINESSES_DIR = path.join(__dirname, '..', 'public', 'images', 'businesses');
const GUIDES_DIR = path.join(__dirname, '..', 'public', 'images', 'guides');
const NEIGHBORHOODS_DIR = path.join(__dirname, '..', 'public', 'images', 'neighborhoods');

// Color palettes per type for visual variety
const CATEGORY_COLORS = {
  // Business categories
  'restaurants': { bg: '#F5EDE3', accent: '#D4784A', text: '#6B4226' },
  'italian-restaurants': { bg: '#F5EDE3', accent: '#C75D3A', text: '#6B4226' },
  'thai-restaurants': { bg: '#FFF8E7', accent: '#E8A946', text: '#7A5C1F' },
  'burger-joints': { bg: '#FFF0E5', accent: '#D46A3A', text: '#7A3D1F' },
  'brunch-spots': { bg: '#FFF8E1', accent: '#E8B946', text: '#7A5C1F' },
  'bars': { bg: '#1C1425', accent: '#9B6BCA', text: '#E8D5F5' },
  'breweries': { bg: '#2A1F14', accent: '#D4A854', text: '#F5E8D0' },
  'pizza': { bg: '#FFF0E5', accent: '#D44A2A', text: '#7A2E1A' },
  'coffee-shops': { bg: '#F5EBE0', accent: '#A67C52', text: '#5C3D20' },
  'gyms': { bg: '#E8F0F5', accent: '#3A7AD4', text: '#1F3D6B' },
  'pilates': { bg: '#F5E8F0', accent: '#B85C9A', text: '#6B2D52' },
  'hair-salons': { bg: '#F5E8EC', accent: '#D45C7A', text: '#7A2D42' },
  'barbers': { bg: '#E8EBF0', accent: '#4A5C7A', text: '#2A3452' },
  'nail-salons': { bg: '#FCE4EC', accent: '#E91E63', text: '#880E4F' },
  'veterinarians': { bg: '#E8F5E9', accent: '#4CAF50', text: '#1B5E20' },
  'dog-walkers': { bg: '#E8F5E9', accent: '#66BB6A', text: '#2E7D32' },
  'pet-stores': { bg: '#FFF8E1', accent: '#FF8F00', text: '#E65100' },
  'dentists': { bg: '#E3F2FD', accent: '#42A5F5', text: '#0D47A1' },
  'physiotherapy': { bg: '#E8F5E9', accent: '#66BB6A', text: '#2E7D32' },
  'coworking-spaces': { bg: '#FFF8E1', accent: '#FFB300', text: '#E65100' },
  'grocery-stores': { bg: '#E8F5E9', accent: '#43A047', text: '#1B5E20' },
  'pharmacies': { bg: '#E3F2FD', accent: '#1E88E5', text: '#0D47A1' },
  'dry-cleaners': { bg: '#ECEFF1', accent: '#546E7A', text: '#263238' },
  'yoga-studios': { bg: '#F3E5F5', accent: '#AB47BC', text: '#4A148C' },
  'chiropractors': { bg: '#E8F5E9', accent: '#4CAF50', text: '#1B5E20' },
  'massage-therapy': { bg: '#F3E5F5', accent: '#9575CD', text: '#311B92' },
  'banks': { bg: '#ECEFF1', accent: '#455A64', text: '#263238' },
  'optometrists': { bg: '#E3F2FD', accent: '#5C6BC0', text: '#1A237E' },
  'dog-groomers': { bg: '#FFF3E0', accent: '#FF9800', text: '#E65100' },
  'doctors': { bg: '#E3F2FD', accent: '#42A5F5', text: '#0D47A1' },
  'bakeries': { bg: '#FFF8E1', accent: '#D4944A', text: '#7A5020' },
  'florists': { bg: '#FCE4EC', accent: '#EC407A', text: '#880E4F' },
  'house-cleaning': { bg: '#E0F7FA', accent: '#00ACC1', text: '#006064' },
  'personal-trainers': { bg: '#E8EAF6', accent: '#5C6BC0', text: '#1A237E' },
  'real-estate-agents': { bg: '#FFF3E0', accent: '#FF7043', text: '#BF360C' },
  'bike-shops': { bg: '#E8F5E9', accent: '#66BB6A', text: '#2E7D32' },
  'accountants': { bg: '#ECEFF1', accent: '#607D8B', text: '#263238' },
  'daycares': { bg: '#FFF9C4', accent: '#FDD835', text: '#F57F17' },
  'caterers': { bg: '#FFF0E5', accent: '#D4784A', text: '#6B4226' },
  'event-spaces': { bg: '#EDE7F6', accent: '#7E57C2', text: '#311B92' },
  'sushi': { bg: '#E8F0F5', accent: '#37474F', text: '#102027' },
  'music-lessons': { bg: '#EDE7F6', accent: '#7E57C2', text: '#311B92' },
  'short-term-rentals': { bg: '#F5EDE3', accent: '#D4A574', text: '#6B5226' },
};

const CATEGORY_LABELS = {
  'restaurants': 'Restaurant',
  'italian-restaurants': 'Italian Restaurant',
  'thai-restaurants': 'Thai Restaurant',
  'burger-joints': 'Burger Joint',
  'brunch-spots': 'Brunch Spot',
  'bars': 'Bar & Nightlife',
  'breweries': 'Craft Brewery',
  'pizza': 'Pizza',
  'coffee-shops': 'Coffee Shop',
  'gyms': 'Fitness & Gym',
  'pilates': 'Pilates Studio',
  'hair-salons': 'Hair Salon',
  'barbers': 'Barbershop',
  'nail-salons': 'Nail Salon',
  'veterinarians': 'Veterinary Clinic',
  'dog-walkers': 'Dog Walking',
  'pet-stores': 'Pet Store',
  'dentists': 'Dental Office',
  'physiotherapy': 'Physiotherapy',
  'coworking-spaces': 'Coworking Space',
  'grocery-stores': 'Grocery Store',
  'pharmacies': 'Pharmacy',
  'dry-cleaners': 'Dry Cleaners',
  'yoga-studios': 'Yoga Studio',
  'chiropractors': 'Chiropractic',
  'massage-therapy': 'Massage Therapy',
  'banks': 'Banking',
  'optometrists': 'Optometry',
  'dog-groomers': 'Dog Grooming',
  'doctors': 'Family Medicine',
  'bakeries': 'Bakery',
  'florists': 'Florist',
  'house-cleaning': 'House Cleaning',
  'personal-trainers': 'Personal Training',
  'real-estate-agents': 'Real Estate',
  'bike-shops': 'Bike Shop',
  'accountants': 'Accounting',
  'daycares': 'Daycare',
  'caterers': 'Catering',
  'event-spaces': 'Event Space',
  'sushi': 'Sushi Restaurant',
  'music-lessons': 'Music Lessons',
  'short-term-rentals': 'Short-Term Rental',
};

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function createPlaceholder(label, sublabel, outputPath, colors, width = 1280, height = 720) {
  const { bg, accent, text } = colors;
  const safeLabel = escapeXml(label);
  const safeSublabel = escapeXml(sublabel);

  // Compute font sizes based on label length
  const labelFontSize = safeLabel.length > 30 ? 36 : safeLabel.length > 20 ? 42 : 48;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${bg};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${accent};stop-opacity:0.15" />
      </linearGradient>
      <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:${accent};stop-opacity:0.4" />
        <stop offset="100%" style="stop-color:${accent};stop-opacity:0.15" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bgGrad)"/>
    <rect x="0" y="${height - 220}" width="100%" height="220" fill="url(#accentGrad)"/>
    <rect x="0" y="${height - 220}" width="100%" height="2" fill="${accent}" opacity="0.3"/>
    <circle cx="${width - 120}" cy="120" r="200" fill="${accent}" opacity="0.06"/>
    <circle cx="120" cy="${height - 100}" r="150" fill="${accent}" opacity="0.06"/>
    <text x="50%" y="42%" font-family="system-ui, -apple-system, Arial, sans-serif" font-size="${labelFontSize}" font-weight="600" fill="${text}" text-anchor="middle" dominant-baseline="middle">${safeLabel}</text>
    <text x="50%" y="55%" font-family="system-ui, -apple-system, Arial, sans-serif" font-size="24" fill="${text}" text-anchor="middle" opacity="0.7">${safeSublabel}</text>
    <text x="50%" y="85%" font-family="system-ui, -apple-system, Arial, sans-serif" font-size="16" fill="${text}" text-anchor="middle" opacity="0.4">libertyvillage.co</text>
  </svg>`;

  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(outputPath);
}

async function main() {
  let totalGenerated = 0;
  let failures = [];

  // ===== STEP 1: Business category images =====
  console.log('=== Generating business category images ===');
  const businessesPath = path.join(__dirname, '..', 'data', 'businesses.json');
  const businesses = JSON.parse(fs.readFileSync(businessesPath, 'utf8'));

  // Group by category
  const catGroups = {};
  businesses.forEach(b => {
    if (!catGroups[b.category]) catGroups[b.category] = [];
    catGroups[b.category].push(b.slug);
  });

  const categories = Object.keys(catGroups);
  console.log(`Found ${categories.length} unique categories across ${businesses.length} businesses`);

  for (const cat of categories) {
    const colors = CATEGORY_COLORS[cat] || { bg: '#F5F0EB', accent: '#D4A574', text: '#8B7355' };
    const label = CATEGORY_LABELS[cat] || cat.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const slugs = catGroups[cat];

    // Generate one image per category, then copy for each business
    const tempPath = path.join('/tmp', `cat-${cat}.jpg`);
    try {
      await createPlaceholder(label, 'Liberty Village, Toronto', tempPath, colors);

      for (const slug of slugs) {
        const destPath = path.join(BUSINESSES_DIR, `${slug}.jpg`);
        fs.copyFileSync(tempPath, destPath);
        totalGenerated++;
      }
      console.log(`  [OK] ${cat}: generated for ${slugs.length} businesses`);
    } catch (err) {
      console.error(`  [FAIL] ${cat}: ${err.message}`);
      failures.push(`business-category:${cat}`);
    }
  }

  // Update businesses.json with image paths
  const updatedBusinesses = businesses.map(b => ({
    ...b,
    image: `/images/businesses/${b.slug}.jpg`
  }));
  fs.writeFileSync(businessesPath, JSON.stringify(updatedBusinesses, null, 2) + '\n');
  console.log(`Updated businesses.json with image paths for ${updatedBusinesses.length} entries`);

  // ===== STEP 2: Guide topic images =====
  console.log('\n=== Generating guide/topic images ===');
  const topicsPath = path.join(__dirname, '..', 'data', 'topics.json');
  const topics = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));

  // Get unique slugs (topics.json may have duplicates)
  const seenSlugs = new Set();
  const uniqueTopics = [];
  topics.forEach(t => {
    if (!seenSlugs.has(t.slug)) {
      seenSlugs.add(t.slug);
      uniqueTopics.push(t);
    }
  });

  console.log(`Found ${topics.length} topic entries, ${uniqueTopics.length} unique slugs`);

  const TOPIC_COLORS = {
    'parking-guide': { bg: '#ECEFF1', accent: '#607D8B', text: '#37474F' },
    'traffic-tips': { bg: '#FFF3E0', accent: '#FF7043', text: '#BF360C' },
    'moving-guide': { bg: '#FFF8E1', accent: '#FFB300', text: '#E65100' },
    'noise-complaints': { bg: '#FFEBEE', accent: '#EF5350', text: '#B71C1C' },
    'internet-providers': { bg: '#E3F2FD', accent: '#42A5F5', text: '#0D47A1' },
    'recycling-waste-guide': { bg: '#E8F5E9', accent: '#66BB6A', text: '#2E7D32' },
    'transit-guide': { bg: '#E3F2FD', accent: '#1E88E5', text: '#0D47A1' },
    'bike-commuting': { bg: '#E8F5E9', accent: '#4CAF50', text: '#1B5E20' },
    'nightlife-guide': { bg: '#1C1425', accent: '#CE93D8', text: '#F3E5F5' },
    'date-night-ideas': { bg: '#FCE4EC', accent: '#EC407A', text: '#880E4F' },
    'family-activities': { bg: '#FFF9C4', accent: '#FDD835', text: '#F57F17' },
    'winter-survival': { bg: '#E3F2FD', accent: '#90CAF9', text: '#0D47A1' },
    'summer-patio-season': { bg: '#FFF8E1', accent: '#FFB74D', text: '#E65100' },
    'fitness-guide': { bg: '#E8EAF6', accent: '#5C6BC0', text: '#1A237E' },
    'remote-work-spots': { bg: '#FFF3E0', accent: '#A1887F', text: '#4E342E' },
    'community-groups': { bg: '#E8F5E9', accent: '#66BB6A', text: '#2E7D32' },
    'history-of-liberty-village': { bg: '#EFEBE9', accent: '#8D6E63', text: '#3E2723' },
    'give-me-liberty-festival': { bg: '#EDE7F6', accent: '#7E57C2', text: '#311B92' },
    'farmers-market': { bg: '#E8F5E9', accent: '#43A047', text: '#1B5E20' },
    'brunch-guide': { bg: '#FFF8E1', accent: '#FFB74D', text: '#E65100' },
    'happy-hour-guide': { bg: '#FFF3E0', accent: '#FF8A65', text: '#BF360C' },
    'new-openings': { bg: '#E8EAF6', accent: '#7986CB', text: '#283593' },
    'safety-guide': { bg: '#E8F5E9', accent: '#26A69A', text: '#004D40' },
    'where-to-stay': { bg: '#F5EDE3', accent: '#D4A574', text: '#6B5226' },
  };

  const TOPIC_LABELS = {
    'parking-guide': 'Parking Guide',
    'traffic-tips': 'Traffic Tips',
    'moving-guide': 'Moving Guide',
    'noise-complaints': 'Noise Complaints',
    'internet-providers': 'Internet Providers',
    'recycling-waste-guide': 'Recycling & Waste',
    'transit-guide': 'Transit Guide',
    'bike-commuting': 'Bike Commuting',
    'nightlife-guide': 'Nightlife Guide',
    'date-night-ideas': 'Date Night Ideas',
    'family-activities': 'Family Activities',
    'winter-survival': 'Winter Survival',
    'summer-patio-season': 'Summer Patio Season',
    'fitness-guide': 'Fitness Guide',
    'remote-work-spots': 'Remote Work Spots',
    'community-groups': 'Community Groups',
    'history-of-liberty-village': 'History of Liberty Village',
    'give-me-liberty-festival': 'Give Me Liberty Festival',
    'farmers-market': "Farmers' Market",
    'brunch-guide': 'Brunch Guide',
    'happy-hour-guide': 'Happy Hour Guide',
    'new-openings': 'New Openings',
    'safety-guide': 'Safety Guide',
    'where-to-stay': 'Where to Stay',
  };

  for (const topic of uniqueTopics) {
    const colors = TOPIC_COLORS[topic.slug] || { bg: '#F5F0EB', accent: '#D4A574', text: '#8B7355' };
    const label = TOPIC_LABELS[topic.slug] || topic.title;
    const destPath = path.join(GUIDES_DIR, `${topic.slug}.jpg`);

    try {
      await createPlaceholder(label, 'Liberty Village Guide', destPath, colors);
      totalGenerated++;
      console.log(`  [OK] ${topic.slug}`);
    } catch (err) {
      console.error(`  [FAIL] ${topic.slug}: ${err.message}`);
      failures.push(`guide:${topic.slug}`);
    }
  }

  // Update topics.json with image paths
  const updatedTopics = topics.map(t => ({
    ...t,
    image: `/images/guides/${t.slug}.jpg`
  }));
  fs.writeFileSync(topicsPath, JSON.stringify(updatedTopics, null, 2) + '\n');
  console.log(`Updated topics.json with image paths for ${updatedTopics.length} entries`);

  // ===== STEP 3: Neighborhood images =====
  console.log('\n=== Generating neighborhood images ===');
  const neighborhoodsPath = path.join(__dirname, '..', 'data', 'neighborhoods.json');
  const neighborhoods = JSON.parse(fs.readFileSync(neighborhoodsPath, 'utf8'));

  console.log(`Found ${neighborhoods.length} neighborhoods`);

  const NEIGHBORHOOD_COLORS = {
    'king-west': { bg: '#1C1425', accent: '#CE93D8', text: '#F3E5F5' },
    'cityplace': { bg: '#ECEFF1', accent: '#78909C', text: '#263238' },
    'queen-west': { bg: '#FCE4EC', accent: '#F06292', text: '#880E4F' },
    'parkdale': { bg: '#FFF3E0', accent: '#FF8A65', text: '#BF360C' },
    'junction': { bg: '#EFEBE9', accent: '#8D6E63', text: '#3E2723' },
    'leslieville': { bg: '#FFF8E1', accent: '#FFB74D', text: '#E65100' },
    'ossington': { bg: '#EDE7F6', accent: '#7E57C2', text: '#311B92' },
    'dundas-west': { bg: '#FFF3E0', accent: '#A1887F', text: '#4E342E' },
    'corktown': { bg: '#EFEBE9', accent: '#A1887F', text: '#3E2723' },
    'distillery-district': { bg: '#EFEBE9', accent: '#8D6E63', text: '#3E2723' },
    'fort-york': { bg: '#E3F2FD', accent: '#42A5F5', text: '#0D47A1' },
    'niagara': { bg: '#E8F5E9', accent: '#66BB6A', text: '#2E7D32' },
    'trinity-bellwoods': { bg: '#E8F5E9', accent: '#4CAF50', text: '#1B5E20' },
    'roncesvalles': { bg: '#FFF8E1', accent: '#D4944A', text: '#7A5020' },
    'bloor-west-village': { bg: '#E8F5E9', accent: '#43A047', text: '#1B5E20' },
  };

  for (const n of neighborhoods) {
    const colors = NEIGHBORHOOD_COLORS[n.slug] || { bg: '#F5F0EB', accent: '#D4A574', text: '#8B7355' };
    const destPath = path.join(NEIGHBORHOODS_DIR, `${n.slug}.jpg`);

    try {
      await createPlaceholder(n.name, 'vs Liberty Village', destPath, colors);
      totalGenerated++;
      console.log(`  [OK] ${n.slug}`);
    } catch (err) {
      console.error(`  [FAIL] ${n.slug}: ${err.message}`);
      failures.push(`neighborhood:${n.slug}`);
    }
  }

  // Update neighborhoods.json with image paths
  const updatedNeighborhoods = neighborhoods.map(n => ({
    ...n,
    image: `/images/neighborhoods/${n.slug}.jpg`
  }));
  fs.writeFileSync(neighborhoodsPath, JSON.stringify(updatedNeighborhoods, null, 2) + '\n');
  console.log(`Updated neighborhoods.json with image paths for ${updatedNeighborhoods.length} entries`);

  // ===== REPORT =====
  console.log('\n========== REPORT ==========');
  console.log(`Total images generated: ${totalGenerated}`);
  console.log(`Failures: ${failures.length}`);
  if (failures.length > 0) {
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`businesses.json: ${updatedBusinesses.length} entries updated with image paths`);
  console.log(`topics.json: ${updatedTopics.length} entries updated with image paths (${uniqueTopics.length} unique images)`);
  console.log(`neighborhoods.json: ${updatedNeighborhoods.length} entries updated with image paths`);
  console.log('============================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
