const escpos = require('escpos');
const fs = require('fs');

// Create a valid 1x1 PNG base64
const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
const buffer = Buffer.from(b64, 'base64');

// Depending on get-pixels, escpos.Image.load might accept buffers if passed with a mimetype, but let's test.
escpos.Image.load(buffer, 'image/png', function (image) {
    if (image) {
        console.log("Image loaded successfully from buffer!", image.size);
    } else {
        console.log("Image loaded but is null/undefined");
    }
});

// Or saving to a temp file and loading:
fs.writeFileSync('temp.png', buffer);
escpos.Image.load('temp.png', function (image) {
    console.log("Image loaded from file:", image.size);
});
