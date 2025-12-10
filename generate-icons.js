/**
 * Icon Generator for LiveConnect PWA
 * 
 * This script generates all required icon sizes from a source image.
 * 
 * USAGE:
 * 1. Install sharp: npm install sharp
 * 2. Place your source icon as "icon-source.png" (1024x1024 recommended)
 * 3. Run: node generate-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const SOURCE = 'icon-source.png';
const OUTPUT_DIR = './icons';

async function generateIcons() {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // Check if source exists
    if (!fs.existsSync(SOURCE)) {
        console.log('❌ Source icon not found: ' + SOURCE);
        console.log('');
        console.log('Please create a 1024x1024 PNG icon named "icon-source.png"');
        console.log('');
        console.log('Quick options:');
        console.log('1. Use Canva (canva.com) to design an icon');
        console.log('2. Use an AI image generator');
        console.log('3. Convert the included icon.svg to PNG');
        console.log('');
        console.log('To convert SVG to PNG, you can use:');
        console.log('- https://svgtopng.com');
        console.log('- https://cloudconvert.com/svg-to-png');
        console.log('- Inkscape, GIMP, or Photoshop');
        return;
    }
    
    console.log('🎨 Generating icons...\n');
    
    for (const size of SIZES) {
        const outputPath = path.join(OUTPUT_DIR, `icon-${size}.png`);
        
        await sharp(SOURCE)
            .resize(size, size, {
                fit: 'cover',
                position: 'center'
            })
            .png()
            .toFile(outputPath);
        
        console.log(`✅ Generated: icon-${size}.png`);
    }
    
    // Generate maskable icons (with padding for safe area)
    for (const size of [192, 512]) {
        const outputPath = path.join(OUTPUT_DIR, `icon-maskable-${size}.png`);
        const padding = Math.round(size * 0.1); // 10% padding
        const innerSize = size - (padding * 2);
        
        await sharp(SOURCE)
            .resize(innerSize, innerSize)
            .extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: { r: 255, g: 45, b: 85, alpha: 1 } // Primary color
            })
            .png()
            .toFile(outputPath);
        
        console.log(`✅ Generated: icon-maskable-${size}.png`);
    }
    
    console.log('\n🎉 All icons generated successfully!');
    console.log('');
    console.log('Files are in the "icons" folder.');
}

generateIcons().catch(console.error);
