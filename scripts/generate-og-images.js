const sharp = require('sharp');
const path = require('path');

const ogDir = path.join(__dirname, '../public/images/og');

const images = [
  { name: 'og-home.jpg', title: 'Liberty Village', subtitle: 'Your Neighborhood Guide', bgColor: '#F59E0B' },
  { name: 'og-service.jpg', title: 'Best Services', subtitle: 'Liberty Village, Toronto', bgColor: '#D97706' },
  { name: 'og-comparison.jpg', title: 'Neighborhood', subtitle: 'Comparison Guide', bgColor: '#65A30D' },
  { name: 'og-directory.jpg', title: 'Business Directory', subtitle: 'Liberty Village', bgColor: '#0891B2' },
  { name: 'og-guide.jpg', title: 'Local Guides', subtitle: 'Liberty Village, Toronto', bgColor: '#7C8B6F' },
];

async function generate() {
  for (const img of images) {
    const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${img.bgColor}"/>
      <rect x="0" y="430" width="100%" height="200" fill="rgba(0,0,0,0.3)"/>
      <text x="600" y="280" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">${img.title}</text>
      <text x="600" y="350" font-family="Arial,sans-serif" font-size="36" fill="rgba(255,255,255,0.9)" text-anchor="middle">${img.subtitle}</text>
      <text x="600" y="540" font-family="Arial,sans-serif" font-size="28" fill="rgba(255,255,255,0.7)" text-anchor="middle">libertyvillage.so</text>
    </svg>`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(path.join(ogDir, img.name));
    console.log('Created', img.name);
  }
}
generate();
