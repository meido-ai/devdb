const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist');

// Check if directory exists before attempting to remove
if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true, force: true });
    console.log('Cleaned dist directory');
}
