const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

async function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = await readdir(dirPath);

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await stat(filePath);

        if (stats.isDirectory()) {
            arrayOfFiles = await getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath);
        }
    }

    return arrayOfFiles;
}

async function createPackage() {
    try {
        const distPath = path.join(__dirname, '..', 'dist');
        const outputPath = path.join(__dirname, '..', 'function.zip');
        const zip = new JSZip();

        // Get all files from dist directory
        const files = await getAllFiles(distPath);

        // Add each file to the zip
        for (const file of files) {
            const content = await readFile(file);
            // Get relative path from dist directory
            const relativePath = path.relative(distPath, file);
            zip.file(relativePath, content);
        }

        // Generate zip file
        const zipContent = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE'
        });

        // Write zip file
        await writeFile(outputPath, zipContent);
        console.log('Lambda package created successfully at:', outputPath);
    } catch (error) {
        console.error('Error creating package:', error);
        process.exit(1);
    }
}

createPackage();
