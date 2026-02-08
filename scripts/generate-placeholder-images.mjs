import sharp from 'sharp';
import { readFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = '/workspace/libertyvillage/public/images';

// Color palette - warm, editorial Toronto neighborhood feel
const COLORS = {
  warmBrick:     { bg: '#8B4513', accent: '#D2691E', text: '#FFF8DC' },
  goldenHour:    { bg: '#B8860B', accent: '#DAA520', text: '#FFFAF0' },
  cafeWarm:      { bg: '#6B4226', accent: '#A0522D', text: '#FAEBD7' },
  urbanGreen:    { bg: '#2E5339', accent: '#4A7C59', text: '#F0FFF0' },
  eveningBlue:   { bg: '#1B2838', accent: '#2C3E50', text: '#E8F0FE' },
  modernGray:    { bg: '#3C3C3C', accent: '#5A5A5A', text: '#F5F5F5' },
  healthWhite:   { bg: '#2E7D6F', accent: '#3AA08E', text: '#FFFFFF' },
  warmOrange:    { bg: '#C46210', accent: '#E07020', text: '#FFFAF0' },
  deepRed:       { bg: '#7B2D26', accent: '#A0413A', text: '#FFF0EE' },
  softPurple:    { bg: '#5B3A6B', accent: '#7B5A8B', text: '#F8F0FF' },
  skyBlue:       { bg: '#2A6496', accent: '#3B7DB8', text: '#F0F8FF' },
  earthBrown:    { bg: '#5C4033', accent: '#8B6914', text: '#FFF8DC' },
  sageGreen:     { bg: '#4A6741', accent: '#6B8E5A', text: '#F5FFF5' },
  coralPink:     { bg: '#B85042', accent: '#D46A5B', text: '#FFF5F5' },
  slateBlue:     { bg: '#3D4F6A', accent: '#5A7099', text: '#F0F5FF' },
};

async function generateImage(filepath, label, subtitle, colors, width = 1280, height = 720) {
  const { bg, accent, text } = colors;

  // Create an SVG with a sophisticated editorial placeholder design
  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bg};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${accent};stop-opacity:1" />
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${text}" stroke-width="0.3" opacity="0.08"/>
    </pattern>
    <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="1" fill="${text}" opacity="0.06"/>
    </pattern>
  </defs>

  <!-- Background gradient -->
  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <!-- Subtle grid pattern -->
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <rect width="${width}" height="${height}" fill="url(#dots)"/>

  <!-- Decorative geometric elements -->
  <rect x="60" y="60" width="${width - 120}" height="${height - 120}" rx="2" ry="2"
        fill="none" stroke="${text}" stroke-width="1" opacity="0.15"/>
  <rect x="80" y="80" width="${width - 160}" height="${height - 160}" rx="2" ry="2"
        fill="none" stroke="${text}" stroke-width="0.5" opacity="0.1"/>

  <!-- Corner accents -->
  <line x1="60" y1="60" x2="120" y2="60" stroke="${text}" stroke-width="2" opacity="0.3"/>
  <line x1="60" y1="60" x2="60" y2="120" stroke="${text}" stroke-width="2" opacity="0.3"/>
  <line x1="${width - 60}" y1="${height - 60}" x2="${width - 120}" y2="${height - 60}" stroke="${text}" stroke-width="2" opacity="0.3"/>
  <line x1="${width - 60}" y1="${height - 60}" x2="${width - 60}" y2="${height - 120}" stroke="${text}" stroke-width="2" opacity="0.3"/>

  <!-- Decorative circle -->
  <circle cx="${width / 2}" cy="${height / 2 - 40}" r="60" fill="none" stroke="${text}" stroke-width="1.5" opacity="0.12"/>
  <circle cx="${width / 2}" cy="${height / 2 - 40}" r="45" fill="none" stroke="${text}" stroke-width="1" opacity="0.08"/>

  <!-- Camera/image icon in circle -->
  <g transform="translate(${width / 2 - 20}, ${height / 2 - 60})" opacity="0.25" fill="${text}">
    <rect x="2" y="8" width="36" height="26" rx="3" ry="3" fill="none" stroke="${text}" stroke-width="2"/>
    <circle cx="20" cy="21" r="8" fill="none" stroke="${text}" stroke-width="2"/>
    <rect x="14" y="4" width="12" height="6" rx="1" ry="1" fill="none" stroke="${text}" stroke-width="1.5"/>
  </g>

  <!-- Main title -->
  <text x="${width / 2}" y="${height / 2 + 50}" font-family="Georgia, 'Times New Roman', serif"
        font-size="36" font-weight="bold" fill="${text}" text-anchor="middle" letter-spacing="2" opacity="0.9">
    ${escapeXml(label)}
  </text>

  <!-- Subtitle -->
  <text x="${width / 2}" y="${height / 2 + 85}" font-family="'Helvetica Neue', Arial, sans-serif"
        font-size="16" fill="${text}" text-anchor="middle" letter-spacing="3" opacity="0.5" text-transform="uppercase">
    ${escapeXml(subtitle)}
  </text>

  <!-- Bottom branding bar -->
  <rect x="0" y="${height - 40}" width="${width}" height="40" fill="${bg}" opacity="0.5"/>
  <text x="${width / 2}" y="${height - 15}" font-family="'Helvetica Neue', Arial, sans-serif"
        font-size="11" fill="${text}" text-anchor="middle" letter-spacing="4" opacity="0.4">
    LIBERTY VILLAGE  ·  TORONTO
  </text>
</svg>`;

  await sharp(Buffer.from(svg))
    .jpeg({ quality: 85, progressive: true })
    .toFile(filepath);
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ============================================================
// NEIGHBORHOOD IMAGES (12)
// ============================================================
const neighborhoodImages = [
  { file: 'brick-loft-streetscape.jpg', label: 'Brick Loft Streetscape', subtitle: 'Golden Hour on Liberty Street', colors: COLORS.warmBrick },
  { file: 'cafe-patio.jpg', label: 'Cafe Patio', subtitle: 'Morning Coffee Culture', colors: COLORS.cafeWarm },
  { file: 'king-st-streetcar.jpg', label: 'King St Streetcar', subtitle: 'TTC Transit on King West', colors: COLORS.deepRed },
  { file: 'rooftop-sunset.jpg', label: 'Rooftop Sunset', subtitle: 'Skyline Views at Golden Hour', colors: COLORS.warmOrange },
  { file: 'dog-park.jpg', label: 'Dog Park', subtitle: 'Community Green Space', colors: COLORS.urbanGreen },
  { file: 'mural-street-art.jpg', label: 'Street Art Mural', subtitle: 'Urban Art & Creative Culture', colors: COLORS.softPurple },
  { file: 'cyclist-trail.jpg', label: 'Cyclist Trail', subtitle: 'Active Urban Lifestyle', colors: COLORS.sageGreen },
  { file: 'condo-lobby.jpg', label: 'Condo Lobby', subtitle: 'Modern Residential Living', colors: COLORS.modernGray },
  { file: 'park-bench.jpg', label: 'Park Bench', subtitle: 'Peaceful Urban Oasis', colors: COLORS.urbanGreen },
  { file: 'playground.jpg', label: 'Playground', subtitle: 'Family-Friendly Spaces', colors: COLORS.skyBlue },
  { file: 'farmers-market.jpg', label: 'Farmers Market', subtitle: 'Local Vendors & Fresh Produce', colors: COLORS.earthBrown },
  { file: 'night-street.jpg', label: 'Night Street', subtitle: 'Evening Dining & Atmosphere', colors: COLORS.eveningBlue },
];

// ============================================================
// SERVICE CATEGORY IMAGES (unique ones)
// ============================================================
const serviceImages = [
  { file: 'restaurants.jpg', label: 'Restaurants', subtitle: 'Neighborhood Dining', colors: COLORS.warmBrick },
  { file: 'coffee-shops.jpg', label: 'Coffee Shops', subtitle: 'Cafe Culture', colors: COLORS.cafeWarm },
  { file: 'gyms.jpg', label: 'Gyms & Fitness', subtitle: 'Stay Active', colors: COLORS.slateBlue },
  { file: 'bars.jpg', label: 'Bars & Nightlife', subtitle: 'Evening Scene', colors: COLORS.eveningBlue },
  { file: 'dentists.jpg', label: 'Dentists', subtitle: 'Dental Care', colors: COLORS.healthWhite },
  { file: 'hair-salons.jpg', label: 'Hair Salons', subtitle: 'Style & Beauty', colors: COLORS.coralPink },
  { file: 'coworking-spaces.jpg', label: 'Coworking Spaces', subtitle: 'Work & Collaborate', colors: COLORS.modernGray },
  { file: 'yoga-studios.jpg', label: 'Yoga Studios', subtitle: 'Mind & Body', colors: COLORS.sageGreen },
  { file: 'pet-stores.jpg', label: 'Pet Stores', subtitle: 'For Your Furry Friends', colors: COLORS.warmOrange },
  { file: 'grocery-stores.jpg', label: 'Grocery Stores', subtitle: 'Fresh & Local', colors: COLORS.urbanGreen },
  { file: 'breweries.jpg', label: 'Breweries', subtitle: 'Craft Beer Culture', colors: COLORS.goldenHour },
  { file: 'pizza.jpg', label: 'Pizza', subtitle: 'Artisan & Classic Pies', colors: COLORS.deepRed },
  { file: 'sushi.jpg', label: 'Sushi', subtitle: 'Japanese Cuisine', colors: COLORS.slateBlue },
  { file: 'physiotherapy.jpg', label: 'Physiotherapy', subtitle: 'Recovery & Rehab', colors: COLORS.skyBlue },
  { file: 'massage-therapy.jpg', label: 'Massage Therapy', subtitle: 'Relaxation & Wellness', colors: COLORS.softPurple },
  { file: 'optometrists.jpg', label: 'Optometrists', subtitle: 'Eye Care & Eyewear', colors: COLORS.skyBlue },
  { file: 'walk-in-clinics.jpg', label: 'Walk-In Clinics', subtitle: 'Healthcare Access', colors: COLORS.healthWhite },
  { file: 'pharmacies.jpg', label: 'Pharmacies', subtitle: 'Prescriptions & Essentials', colors: COLORS.healthWhite },
  { file: 'daycares.jpg', label: 'Daycares', subtitle: 'Childcare & Learning', colors: COLORS.warmOrange },
  { file: 'dry-cleaners.jpg', label: 'Dry Cleaners', subtitle: 'Professional Cleaning', colors: COLORS.modernGray },
  { file: 'auto-mechanics.jpg', label: 'Auto Mechanics', subtitle: 'Vehicle Service & Repair', colors: COLORS.earthBrown },
  { file: 'accountants.jpg', label: 'Accountants', subtitle: 'Financial Services', colors: COLORS.slateBlue },
  { file: 'lawyers.jpg', label: 'Lawyers', subtitle: 'Legal Services', colors: COLORS.earthBrown },
  { file: 'real-estate-agents.jpg', label: 'Real Estate', subtitle: 'Buy, Sell & Rent', colors: COLORS.goldenHour },
  { file: 'brunch-spots.jpg', label: 'Brunch Spots', subtitle: 'Weekend Brunch Culture', colors: COLORS.warmOrange },
  // Additional unique images for remaining service categories
  { file: 'barbers.jpg', label: 'Barbers', subtitle: 'Classic & Modern Cuts', colors: COLORS.earthBrown },
  { file: 'nail-salons.jpg', label: 'Nail Salons', subtitle: 'Manicures & Pedicures', colors: COLORS.coralPink },
  { file: 'veterinarians.jpg', label: 'Veterinarians', subtitle: 'Pet Healthcare', colors: COLORS.sageGreen },
  { file: 'dog-walkers.jpg', label: 'Dog Walkers', subtitle: 'Daily Dog Care', colors: COLORS.urbanGreen },
  { file: 'dog-groomers.jpg', label: 'Dog Groomers', subtitle: 'Pet Grooming', colors: COLORS.warmOrange },
  { file: 'personal-trainers.jpg', label: 'Personal Trainers', subtitle: 'Fitness Coaching', colors: COLORS.slateBlue },
  { file: 'pilates.jpg', label: 'Pilates Studios', subtitle: 'Core Strength & Flexibility', colors: COLORS.sageGreen },
  { file: 'chiropractors.jpg', label: 'Chiropractors', subtitle: 'Spinal Health', colors: COLORS.skyBlue },
  { file: 'doctors.jpg', label: 'Doctors', subtitle: 'Family Medicine', colors: COLORS.healthWhite },
  { file: 'house-cleaning.jpg', label: 'House Cleaning', subtitle: 'Home Care Services', colors: COLORS.skyBlue },
  { file: 'movers.jpg', label: 'Moving Companies', subtitle: 'Relocation Services', colors: COLORS.slateBlue },
  { file: 'tailors.jpg', label: 'Tailors', subtitle: 'Alterations & Custom Fits', colors: COLORS.earthBrown },
  { file: 'auto-repair.jpg', label: 'Auto Repair', subtitle: 'Vehicle Maintenance', colors: COLORS.modernGray },
  { file: 'bike-shops.jpg', label: 'Bike Shops', subtitle: 'Cycling Gear & Repairs', colors: COLORS.sageGreen },
  { file: 'insurance-agents.jpg', label: 'Insurance Agents', subtitle: 'Coverage & Protection', colors: COLORS.slateBlue },
  { file: 'banks.jpg', label: 'Banks', subtitle: 'Banking & Finance', colors: COLORS.modernGray },
  { file: 'tutors.jpg', label: 'Tutors', subtitle: 'Education & Learning', colors: COLORS.softPurple },
  { file: 'music-lessons.jpg', label: 'Music Lessons', subtitle: 'Learn & Play', colors: COLORS.deepRed },
  { file: 'florists.jpg', label: 'Florists', subtitle: 'Fresh Flowers & Arrangements', colors: COLORS.coralPink },
  { file: 'photographers.jpg', label: 'Photographers', subtitle: 'Capture Every Moment', colors: COLORS.modernGray },
  { file: 'caterers.jpg', label: 'Caterers', subtitle: 'Event & Office Catering', colors: COLORS.warmBrick },
  { file: 'event-spaces.jpg', label: 'Event Spaces', subtitle: 'Venues & Celebrations', colors: COLORS.softPurple },
  { file: 'wine-bars.jpg', label: 'Wine Bars', subtitle: 'Wine & Ambiance', colors: COLORS.deepRed },
  { file: 'thai-restaurants.jpg', label: 'Thai Restaurants', subtitle: 'Thai Cuisine', colors: COLORS.warmOrange },
  { file: 'italian-restaurants.jpg', label: 'Italian Restaurants', subtitle: 'Italian Dining', colors: COLORS.deepRed },
  { file: 'indian-restaurants.jpg', label: 'Indian Restaurants', subtitle: 'Indian Cuisine', colors: COLORS.goldenHour },
  { file: 'burger-joints.jpg', label: 'Burger Joints', subtitle: 'Burgers & Fries', colors: COLORS.warmBrick },
  { file: 'bakeries.jpg', label: 'Bakeries', subtitle: 'Bread & Pastries', colors: COLORS.cafeWarm },
  { file: 'laundromats.jpg', label: 'Laundromats', subtitle: 'Laundry Services', colors: COLORS.skyBlue },
  { file: 'tattoo-parlors.jpg', label: 'Tattoo Parlors', subtitle: 'Ink & Art', colors: COLORS.eveningBlue },
  { file: 'spas.jpg', label: 'Spas', subtitle: 'Relaxation & Wellness', colors: COLORS.softPurple },
  { file: 'printing-services.jpg', label: 'Printing Services', subtitle: 'Print & Design', colors: COLORS.modernGray },
  { file: 'it-support.jpg', label: 'IT Support', subtitle: 'Tech & Troubleshooting', colors: COLORS.slateBlue },
  { file: 'interior-designers.jpg', label: 'Interior Designers', subtitle: 'Home & Space Design', colors: COLORS.cafeWarm },
  { file: 'locksmith.jpg', label: 'Locksmiths', subtitle: 'Security & Access', colors: COLORS.modernGray },
  { file: 'short-term-rentals.jpg', label: 'Short-Term Rentals', subtitle: 'Stays & Accommodations', colors: COLORS.goldenHour },
  { file: 'patios.jpg', label: 'Patios', subtitle: 'Outdoor Dining', colors: COLORS.warmOrange },
  { file: 'nightlife-guide.jpg', label: 'Nightlife Guide', subtitle: 'After Dark', colors: COLORS.eveningBlue },
  { file: 'family-activities.jpg', label: 'Family Activities', subtitle: 'Fun For All Ages', colors: COLORS.skyBlue },
];

async function main() {
  let neighborhoodCount = 0;
  let serviceCount = 0;
  let failures = [];

  // Generate neighborhood images
  console.log('Generating neighborhood images...');
  for (const img of neighborhoodImages) {
    const filepath = join(ROOT, 'neighborhood', img.file);
    try {
      await generateImage(filepath, img.label, img.subtitle, img.colors);
      neighborhoodCount++;
      console.log(`  ✓ neighborhood/${img.file}`);
    } catch (e) {
      failures.push(`neighborhood/${img.file}: ${e.message}`);
      console.error(`  ✗ neighborhood/${img.file}: ${e.message}`);
    }
  }

  // Generate service images
  console.log('\nGenerating service images...');
  for (const img of serviceImages) {
    const filepath = join(ROOT, 'services', img.file);
    try {
      await generateImage(filepath, img.label, img.subtitle, img.colors);
      serviceCount++;
      console.log(`  ✓ services/${img.file}`);
    } catch (e) {
      failures.push(`services/${img.file}: ${e.message}`);
      console.error(`  ✗ services/${img.file}: ${e.message}`);
    }
  }

  // Now update services.json
  console.log('\nUpdating services.json...');
  const servicesPath = '/workspace/libertyvillage/data/services.json';
  const services = JSON.parse(readFileSync(servicesPath, 'utf-8'));

  let updatedCount = 0;
  for (const service of services) {
    const imgPath = `/images/services/${service.slug}.jpg`;
    const fullPath = join(ROOT, 'services', `${service.slug}.jpg`);
    if (existsSync(fullPath)) {
      service.image = imgPath;
      updatedCount++;
    } else {
      console.warn(`  Warning: No image for slug "${service.slug}"`);
      // Still set the image path for consistency, image will be generated
      service.image = imgPath;
      updatedCount++;
    }
  }

  // Write updated services.json
  const fs = await import('fs');
  fs.writeFileSync(servicesPath, JSON.stringify(services, null, 2) + '\n');
  console.log(`\nUpdated ${updatedCount} service entries in services.json with image paths.`);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Neighborhood images generated: ${neighborhoodCount}/12`);
  console.log(`Service images generated: ${serviceCount}/${serviceImages.length}`);
  console.log(`Services.json entries updated: ${updatedCount}/${services.length}`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.length}`);
    failures.forEach(f => console.log(`  - ${f}`));
  } else {
    console.log('No failures.');
  }
}

main().catch(console.error);
