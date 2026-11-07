const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const escpos = require('escpos');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { createLogger, format, transports } = require('winston');

// --- Structured Logging ---
const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: { service: 'thermalflow-print-server' },
    transports: [
        new transports.File({ filename: 'logs/error.log', level: 'error' }),
        new transports.File({ filename: 'logs/combined.log' }),
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        })
    ]
});

// --- Compatibility Fix: escpos-usb expects the 'usb' module to be an EventEmitter ---
const usbModule = require('usb');
if (!usbModule.on && usbModule.usb && usbModule.usb.on) {
    logger.info("[Compatibility] Patching 'usb' module for escpos-usb...");
    const target = usbModule.usb;
    usbModule.on = (...args) => target.on(...args);
    usbModule.emit = (...args) => target.emit(...args);
    usbModule.once = (...args) => target.once(...args);
    usbModule.removeListener = (...args) => target.removeListener(...args);
    usbModule.removeAllListeners = (event) => {
        if (event === 'detach') {
            return;
        }
        target.removeAllListeners(event);
    };
    if (!usbModule.findByIds && target.findByIds) {
        usbModule.findByIds = (...args) => target.findByIds(...args);
    }
}

// Attempt to load USB adapter
try {
    escpos.USB = require('escpos-usb');
} catch (e) {
    logger.warn("escpos-usb NOT FOUND. Please install it: npm install escpos-usb");
}

const app = express();
const port = process.env.PRINT_SERVER_PORT || 3001;

app.set('trust proxy', 1);

// --- Rate Limiting ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Increased limit
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Always allow internal loopback requests from server.js proxy
        const ip = req.ip || req.connection?.remoteAddress;
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    }
});

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(limiter);


// --- Queue Persistence ---
const QUEUE_FILE = path.join(__dirname, 'print-queue.json');

function saveQueue() {
    try {
        const data = printQueue.map(item => ({
            type: item.type,
            payload: item.payload,
            retries: item.retries
        }));
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        logger.error("Failed to save queue:", e);
    }
}

function loadQueue() {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
            const data = JSON.parse(raw);
            logger.info(`Loaded ${data.length} pending print jobs from disk`);
            return data;
        }
    } catch (e) {
        logger.error("Failed to load queue:", e);
    }
    return [];
}

// --- Printer Status Check ---
function checkPrinterStatus() {
    return new Promise((resolve) => {
        try {
            if (typeof escpos.USB === 'undefined') {
                return resolve({ connected: false, error: 'escpos-usb not loaded' });
            }
            const printers = escpos.USB.findPrinter();
            if (printers && printers.length > 0) {
                const target = printers.find(p =>
                    p.deviceDescriptor.idVendor === 0x4b8 &&
                    p.deviceDescriptor.idProduct === 0xe28
                );
                resolve({
                    connected: true,
                    printerFound: !!target,
                    vendorId: target ? '0x4b8' : null,
                    productId: target ? '0xe28' : null,
                    availablePrinters: printers.length
                });
            } else {
                resolve({ connected: false, error: 'No USB printers found' });
            }
        } catch (e) {
            resolve({ connected: false, error: e.message });
        }
    });
}

// --- Print Queue with Persistence ---
let printQueue = [];
let isProcessingQueue = false;

function processQueue() {
    if (isProcessingQueue || printQueue.length === 0) {
        if (printQueue.length === 0) saveQueue();
        return;
    }
    isProcessingQueue = true;

    const item = printQueue.shift();
    const { job, resolve, reject, type, payload, retries = 0 } = item;

    job()
        .then(() => {
            logger.info(`Print job completed: ${type}`, { payload: sanitizePayload(payload) });
            resolve();
        })
        .catch((err) => {
            logger.error(`Print job failed: ${type}`, { error: err.message, retries });
            if (retries < 2) {
                // Retry with exponential backoff
                const delay = Math.pow(2, retries) * 500;
                logger.info(`Retrying in ${delay}ms... (attempt ${retries + 1}/3)`);
                setTimeout(() => {
                    printQueue.unshift({ ...item, retries: retries + 1 });
                    isProcessingQueue = false;
                    processQueue();
                }, delay);
                return;
            }
            reject(err);
        })
        .finally(() => {
            isProcessingQueue = false;
            saveQueue();
            setTimeout(processQueue, 1000);
        });
}

function sanitizePayload(payload) {
    const sanitized = { ...payload };
    if (sanitized.image) {
        sanitized.image = '[BASE64_IMAGE_REDACTED]';
    }
    return sanitized;
}

function addToQueue(job, type, payload) {
    return new Promise((resolve, reject) => {
        printQueue.push({ job, resolve, reject, type, payload, retries: 0 });
        saveQueue();
        processQueue();
    });
}

// --- Image Validation ---
function validateImage(imageStr) {
    if (!imageStr) return { valid: true };

    if (typeof imageStr !== 'string') {
        return { valid: false, error: 'Image must be a string' };
    }

    if (imageStr.length > 2_000_000) {
        return { valid: false, error: 'Image too large (max 2MB base64)' };
    }

    const dataUriMatch = imageStr.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/);
    if (!dataUriMatch) {
        return { valid: false, error: 'Invalid image data URI format. Expected data:image/png;base64,...' };
    }

    const format = dataUriMatch[1];
    if (format !== 'png') {
        return { valid: false, error: `Unsupported image format: ${format}. Only PNG is supported for thermal printing.` };
    }

    try {
        const base64Data = dataUriMatch[2];
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length === 0) {
            return { valid: false, error: 'Image buffer is empty' };
        }
        // Check PNG magic bytes
        if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47) {
            return { valid: false, error: 'Invalid PNG file signature' };
        }
        return { valid: true, buffer };
    } catch (e) {
        return { valid: false, error: `Failed to decode image: ${e.message}` };
    }
}

// --- Character Sanitization ---
// Replaces Unicode characters that don't map correctly in GB18030 encoding
function sanitizeText(text) {
    if (!text) return text;
    return text
        .replace(/•/g, '-')           // bullet
        .replace(/[—–]/g, '--')       // em/en dash
        .replace(/['']/g, "'")        // smart quotes
        .replace(/[""]/g, '"')        // smart double quotes
        .replace(/°/g, ' deg')        // degree symbol
        .replace(/…/g, '...')         // ellipsis
        .replace(/×/g, 'x')           // multiplication sign
        .replace(/÷/g, '/')           // division sign
        .replace(/½/g, '1/2')         // fractions
        .replace(/¼/g, '1/4')
        .replace(/¾/g, '3/4')
        .replace(/⅓/g, '1/3')
        .replace(/⅔/g, '2/3')
        .replace(/[^\x00-\x7F]/g, ''); // Remove any remaining non-ASCII chars
}

function sanitizeTasks(tasks) {
    if (!Array.isArray(tasks)) return tasks;
    return tasks.map(t => sanitizeText(t));
}

// --- Print Templates ---
const templates = {
    default: (printer, title, date, tasks, imageStr) => {
        printer
            .font('a')
            .align('ct')
            .style('b')
            .size(1, 1)
            .text(sanitizeText(title) || 'THERMALFLOW')
            .size(0, 0)
            .style('normal')
            .text(date || new Date().toLocaleString())
            .text('--------------------------------')
            .align('lt');

        if (tasks && Array.isArray(tasks)) {
            sanitizeTasks(tasks).forEach(task => printer.text(task));
        }
    },
    minimal: (printer, title, date, tasks, imageStr) => {
        printer
            .font('a')
            .align('lt')
            .text(sanitizeText(title) || 'NOTE')
            .text('---');
        if (tasks && Array.isArray(tasks)) {
            sanitizeTasks(tasks).forEach(task => printer.text(`- ${task}`));
        }
    },
    receipt: (printer, title, date, tasks, imageStr) => {
        printer
            .font('a')
            .align('ct')
            .style('b')
            .text(sanitizeText(title) || 'RECEIPT')
            .style('normal')
            .text(date || new Date().toLocaleString())
            .text('================================')
            .align('lt');
        if (tasks && Array.isArray(tasks)) {
            sanitizeTasks(tasks).forEach(task => printer.text(`  ${task}`));
        }
    }
};

function getTemplate(name) {
    return templates[name] || templates.default;
}

// --- Helper function to perform a print job ---
function performPrint(title, date, tasks, imageStr, templateName) {
    return new Promise((resolve, reject) => {
        try {
            let device;
            const printers = escpos.USB.findPrinter();

            if (printers && printers.length > 0) {
                const target = printers.find(p =>
                    p.deviceDescriptor.idVendor === 0x4b8 &&
                    p.deviceDescriptor.idProduct === 0xe28
                );

                if (target) {
                    logger.info(`Found target printer: VID 0x${target.deviceDescriptor.idVendor.toString(16)}, PID 0x${target.deviceDescriptor.idProduct.toString(16)}`);
                    device = new escpos.USB(target);
                } else {
                    logger.info(`Using first available printer (VID 0x${printers[0].deviceDescriptor.idVendor.toString(16)}).`);
                    device = new escpos.USB(printers[0]);
                }
            } else {
                logger.info("Falling back to hardcoded VID/PID...");
                device = new escpos.USB(0x4b8, 0xe28);
            }

            const options = { encoding: "ascii" };
            const printer = new escpos.Printer(device, options);

            device.open(function (error) {
                if (error) {
                    logger.error("Printer Connection Error:", error);
                    return reject(new Error('Printer not ready'));
                }

                logger.info("Printer Connected. Printing...");

                // Validate image if provided
                if (imageStr) {
                    const validation = validateImage(imageStr);
                    if (!validation.valid) {
                        device.close();
                        return reject(new Error(validation.error));
                    }
                }

                const template = getTemplate(templateName);

                if (imageStr) {
                    try {
                        const base64Data = imageStr.replace(/^data:image\/png;base64,/, "");
                        const buffer = Buffer.from(base64Data, 'base64');
                        escpos.Image.load(buffer, 'image/png', function (img) {
                            if (!img) {
                                logger.error("Failed to load image buffer");
                                return closePrinter();
                            }
                            template(printer, title, date, tasks, imageStr);
                            printer
                                .align('ct')
                                .raster(img)
                                .feed(3)
                                .cut()
                                .close(() => {
                                    logger.info("Print Success (with image)");
                                    resolve();
                                });
                        });
                        return;
                    } catch (err) {
                        logger.error("Error processing image:", err);
                    }
                }

                // Normal Text Print (No Image)
                template(printer, title, date, tasks, imageStr);

                function closePrinter() {
                    printer
                        .feed(3)
                        .cut()
                        .close(() => {
                            logger.info("Print Success");
                            resolve();
                        });
                }

                closePrinter();
            });

        } catch (e) {
            logger.error("USB Device Initialization Failed:", e.message);
            reject(new Error('Printer device not found'));
        }
    });
}

// Helper function for individual task printing
function performSinglePrint(taskName, options = {}) {
    const { qrUrl, priority } = options;
    const isUrgent = priority === 'urgent' || taskName.includes('!urgent') || taskName.includes('!high');
    const cleanTitle = sanitizeText(taskName.replace(/!urgent|!high/gi, '').trim());

    return new Promise((resolve, reject) => {
        try {
            let device;
            const printers = escpos.USB.findPrinter();

            if (printers && printers.length > 0) {
                const target = printers.find(p =>
                    p.deviceDescriptor.idVendor === 0x4b8 &&
                    p.deviceDescriptor.idProduct === 0xe28
                );
                device = new escpos.USB(target || printers[0]);
            } else {
                device = new escpos.USB(0x4b8, 0xe28);
            }

            const printOptions = { encoding: "ascii" };
            const printer = new escpos.Printer(device, printOptions);

            device.open(async function (error) {
                if (error) {
                    logger.error("Printer Connection Error:", error);
                    return reject(new Error('Printer not ready'));
                }

                logger.info(`Printing individual task: ${cleanTitle}`);

                printer
                    .font('a')
                    .align('ct')
                    .style('b');

                if (isUrgent) {
                    printer
                        .size(1, 1)
                        .text('*** [ URGENT ] ***')
                        .feed(1);
                }

                printer
                    .size(1, 1)
                    .text('------------------------')
                    .feed(1)
                    .size(2, 2)
                    .text(cleanTitle)
                    .size(1, 1)
                    .feed(1)
                    .text('------------------------');

                if (qrUrl) {
                    try {
                        const qrBuffer = await QRCode.toBuffer(qrUrl, {
                            type: 'png',
                            width: 140,
                            margin: 1,
                            color: { dark: '#000000', light: '#FFFFFF' }
                        });
                        escpos.Image.load(qrBuffer, 'image/png', function (img) {
                            if (img) {
                                printer
                                    .feed(1)
                                    .align('ct')
                                    .raster(img)
                                    .size(0, 0)
                                    .text('SCAN TO COMPLETE');
                            }
                            finishPrint();
                        });
                        return;
                    } catch (qrErr) {
                        logger.warn("Mini QR generation failed on single print:", qrErr.message);
                    }
                }

                finishPrint();

                function finishPrint() {
                    printer
                        .feed(2)
                        .cut()
                        .close(() => {
                            logger.info("Single Print Success");
                            resolve();
                        });
                }
            });

        } catch (e) {
            logger.error("USB Device Initialization Failed:", e.message);
            reject(new Error('Printer device not found'));
        }
    });
}

function performActionPlanPrint(goalTitle, subtasks) {
    return new Promise((resolve, reject) => {
        try {
            let device;
            const printers = escpos.USB.findPrinter();
            if (printers && printers.length > 0) {
                const target = printers.find(p =>
                    p.deviceDescriptor.idVendor === 0x4b8 &&
                    p.deviceDescriptor.idProduct === 0xe28
                );
                device = new escpos.USB(target || printers[0]);
            } else {
                device = new escpos.USB(0x4b8, 0xe28);
            }

            const printer = new escpos.Printer(device, { encoding: 'ascii' });

            device.open(async (error) => {
                if (error) {
                    logger.error("Could not open USB device for Action Plan:", error);
                    return reject(new Error('Failed to open USB device'));
                }

                try {
                    printer.font('a').align('ct').style('b').size(1, 1).text('ACTION PLAN').size(0, 0).style('normal');
                    printer.text('================================');
                    printer.style('b').text(sanitizeText(goalTitle.toUpperCase())).style('normal');
                    printer.text(new Date().toLocaleString());
                    printer.text('--------------------------------');

                    for (let i = 0; i < subtasks.length; i++) {
                        const item = subtasks[i];
                        const stepText = typeof item === 'string' ? item : item.title;
                        const qrUrl = typeof item === 'object' ? item.qrUrl : null;

                        printer.align('lt').style('b').text(`[ ] STEP ${i + 1}:`).style('normal');
                        printer.text(`    ${sanitizeText(stepText)}`);

                        if (qrUrl) {
                            try {
                                const qrBuffer = await QRCode.toBuffer(qrUrl, {
                                    type: 'png',
                                    width: 120,
                                    margin: 1,
                                    color: { dark: '#000000', light: '#FFFFFF' }
                                });
                                await new Promise((resQr) => {
                                    escpos.Image.load(qrBuffer, 'image/png', function (img) {
                                        if (img) {
                                            printer.feed(1).align('ct').raster(img).size(0, 0).text('SCAN TO COMPLETE');
                                        }
                                        resQr();
                                    });
                                });
                            } catch (qrErr) {
                                logger.warn("Step QR generation failed:", qrErr.message);
                            }
                        }

                        if (i < subtasks.length - 1) {
                            printer.align('ct').text('- - - - - - - - - - - - - - - -');
                        }
                    }

                    printer.text('================================');
                    printer.align('ct').text('*** TEAR-OFF ACTION CHECKLIST ***');
                    printer.feed(2).cut().close(() => {
                        logger.info(`Action Plan printed successfully: "${goalTitle}" (${subtasks.length} steps)`);
                        resolve({ success: true });
                    });
                } catch (printErr) {
                    logger.error("Print execution error in Action Plan:", printErr);
                    try { device.close(); } catch (e) { }
                    reject(printErr);
                }
            });
        } catch (e) {
            logger.error("USB Device Init Failed for Action Plan:", e.message);
            reject(new Error('Printer device not found'));
        }
    });
}



// --- API Endpoints ---

// Health Check / Diagnostics
app.get('/health', async (req, res) => {
    const printerStatus = await checkPrinterStatus();
    res.json({
        status: 'alive',
        usbAvailable: typeof escpos.USB !== 'undefined',
        printer: printerStatus,
        queueLength: printQueue.length,
        message: 'Printer server is running on port 3001'
    });
});

// Printer Status Endpoint
app.get('/printer-status', async (req, res) => {
    const status = await checkPrinterStatus();
    res.json(status);
});

// Queue Status
app.get('/queue', (req, res) => {
    res.json({
        length: printQueue.length,
        isProcessing: isProcessingQueue,
        jobs: printQueue.map(j => ({ type: j.type, retries: j.retries }))
    });
});

// Print Manifest (Multi-line with optional image)
app.post('/print', async (req, res) => {
    const { title, date, tasks, image, template } = req.body;

    // Input validation
    if (title && (typeof title !== 'string' || title.length > 100)) {
        return res.status(400).json({ error: 'Invalid title: must be string under 100 chars' });
    }
    if (date && (typeof date !== 'string' || date.length > 50)) {
        return res.status(400).json({ error: 'Invalid date: must be string under 50 chars' });
    }
    if (tasks && (!Array.isArray(tasks) || tasks.some(t => typeof t !== 'string' || t.length > 200))) {
        return res.status(400).json({ error: 'Invalid tasks: must be array of strings under 200 chars each' });
    }
    if (tasks && tasks.length > 50) {
        return res.status(400).json({ error: 'Too many tasks: max 50 per print job' });
    }

    if (image) {
        const validation = validateImage(image);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
    }

    logger.info(`Queueing Manifest Print: ${title} (${tasks ? tasks.length : 0} tasks) ${image ? '[IMAGE]' : ''}`);

    try {
        await addToQueue(
            () => performPrint(title, date, tasks, image, template),
            'manifest',
            { title, taskCount: tasks?.length, hasImage: !!image, template }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Print Single Task
app.post('/print-single', async (req, res) => {
    const { taskName, qrUrl, priority } = req.body;

    // Input validation
    if (!taskName || typeof taskName !== 'string' || taskName.trim().length === 0) {
        return res.status(400).json({ error: 'taskName is required and must be a non-empty string' });
    }
    if (taskName.length > 200) {
        return res.status(400).json({ error: 'taskName too long: max 200 chars' });
    }

    logger.info(`Queueing Single Print: ${taskName}${qrUrl ? ' [WITH QR]' : ''}`);

    try {
        await addToQueue(
            () => performSinglePrint(taskName.trim(), { qrUrl, priority }),
            'single',
            { taskName: taskName.substring(0, 50), hasQR: !!qrUrl }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Action Plan Checklist Print Endpoint
app.post('/print-action-plan', async (req, res) => {
    const { goalTitle, subtasks } = req.body;
    if (!goalTitle || typeof goalTitle !== 'string') {
        return res.status(400).json({ error: 'goalTitle is required' });
    }
    if (!subtasks || !Array.isArray(subtasks) || subtasks.length === 0) {
        return res.status(400).json({ error: 'subtasks must be a non-empty array' });
    }

    logger.info(`Queueing Action Plan Print: "${goalTitle}" with ${subtasks.length} steps`);
    try {
        await addToQueue(
            () => performActionPlanPrint(goalTitle.trim(), subtasks),
            'action-plan',
            { goalTitle: goalTitle.substring(0, 50), stepsCount: subtasks.length }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// QR Code Generation Endpoint
app.post('/print-qr', async (req, res) => {
    const { url, title } = req.body;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
    }
    if (url.length > 500) {
        return res.status(400).json({ error: 'url too long: max 500 chars' });
    }

    try {
        // Generate QR code as PNG buffer
        const qrBuffer = await QRCode.toBuffer(url, {
            type: 'png',
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#FFFFFF' }
        });

        const base64 = qrBuffer.toString('base64');
        const dataUri = `data:image/png;base64,${base64}`;

        logger.info(`Queueing QR Print: ${url}`);

        await addToQueue(
            () => performPrint(title || 'QR CODE', new Date().toLocaleString(), [url], dataUri, 'default'),
            'qr',
            { url, title }
        );
        res.json({ success: true });
    } catch (error) {
        logger.error("QR generation failed:", error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Barcode Generation Endpoint (EAN13, CODE128, etc.)
app.post('/print-barcode', async (req, res) => {
    const { data, format = 'CODE128', title } = req.body;

    if (!data || typeof data !== 'string') {
        return res.status(400).json({ error: 'data is required' });
    }

    // Note: escpos has built-in barcode support for many formats
    // This endpoint prints the barcode using native printer commands
    logger.info(`Queueing Barcode Print: ${format} - ${data}`);

    try {
        await addToQueue(
            () => performBarcodePrint(data, format, title),
            'barcode',
            { data, format, title }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function performBarcodePrint(data, format, title) {
    return new Promise((resolve, reject) => {
        try {
            let device;
            const printers = escpos.USB.findPrinter();
            if (printers && printers.length > 0) {
                const target = printers.find(p =>
                    p.deviceDescriptor.idVendor === 0x4b8 &&
                    p.deviceDescriptor.idProduct === 0xe28
                );
                device = new escpos.USB(target || printers[0]);
            } else {
                device = new escpos.USB(0x4b8, 0xe28);
            }

            const options = { encoding: "ascii" };
            const printer = new escpos.Printer(device, options);

            device.open(function (error) {
                if (error) {
                    logger.error("Printer Connection Error:", error);
                    return reject(new Error('Printer not ready'));
                }

                printer
                    .font('a')
                    .align('ct')
                    .style('b')
                    .text(title || 'BARCODE')
                    .style('normal')
                    .text('--------------------------------');

                // escpos barcode command: printer.barcode(data, format, options)
                try {
                    printer.barcode(data, format, { width: 2, height: 100 });
                } catch (e) {
                    logger.warn(`Barcode format ${format} not supported, printing as text:`, e.message);
                    printer.text(data);
                }

                printer
                    .text('--------------------------------')
                    .feed(3)
                    .cut()
                    .close(() => {
                        logger.info("Barcode Print Success");
                        resolve();
                    });
            });
        } catch (e) {
            logger.error("USB Device Initialization Failed:", e.message);
            reject(new Error('Printer device not found'));
        }
    });
}

// --- Proxy /mcp, /.well-known/*, and /oauth/* to main server (port 3000) ---
const MAIN_SERVER_BASE = process.env.MAIN_SERVER_BASE || 'http://localhost:3000';

function buildForwardHeaders(req, extra = {}) {
    const headers = {
        'X-Forwarded-Proto': req.headers['x-forwarded-proto'] || req.protocol || 'https',
        'X-Forwarded-Host': req.headers['x-forwarded-host'] || req.headers.host || 'print.nebulous.space',
        ...extra
    };
    if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
    }
    if (req.headers.accept) {
        headers['Accept'] = req.headers.accept;
    }
    return headers;
}

const wellKnownPaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration'
];

wellKnownPaths.forEach((wkPath) => {
    app.get(wkPath, async (req, res) => {
        try {
            const response = await fetch(`${MAIN_SERVER_BASE}${wkPath}`, {
                headers: buildForwardHeaders(req)
            });
            const data = await response.json();
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(response.status).json(data);
        } catch (err) {
            res.status(502).json({ error: 'Main ThermalFlow server unreachable', details: err.message });
        }
    });
});

app.post('/oauth/register', async (req, res) => {
    try {
        const response = await fetch(`${MAIN_SERVER_BASE}/oauth/register`, {
            method: 'POST',
            headers: buildForwardHeaders(req, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(req.body || {})
        });
        const data = await response.json();
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(response.status).json(data);
    } catch (err) {
        res.status(502).json({ error: 'Main ThermalFlow server unreachable', details: err.message });
    }
});

app.get('/oauth/authorize', async (req, res) => {
    try {
        const qs = new URLSearchParams(req.query).toString();
        const response = await fetch(`${MAIN_SERVER_BASE}/oauth/authorize${qs ? `?${qs}` : ''}`, {
            headers: buildForwardHeaders(req),
            redirect: 'manual'
        });
        const location = response.headers.get('location');
        if (location && (response.status === 301 || response.status === 302)) {
            return res.redirect(response.status, location);
        }
        const html = await response.text();
        res.status(response.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
    } catch (err) {
        res.status(502).send(`Main server unreachable: ${err.message}`);
    }
});

app.post('/oauth/authorize', async (req, res) => {
    try {
        const response = await fetch(`${MAIN_SERVER_BASE}/oauth/authorize`, {
            method: 'POST',
            headers: buildForwardHeaders(req, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ ...req.query, ...req.body }),
            redirect: 'manual'
        });
        const location = response.headers.get('location');
        if (location && (response.status === 301 || response.status === 302)) {
            return res.redirect(response.status, location);
        }
        const contentType = response.headers.get('content-type') || 'text/html; charset=utf-8';
        const bodyText = await response.text();
        res.status(response.status).setHeader('Content-Type', contentType).send(bodyText);
    } catch (err) {
        res.status(502).send(`Main server unreachable: ${err.message}`);
    }
});

app.post('/oauth/token', async (req, res) => {
    try {
        const response = await fetch(`${MAIN_SERVER_BASE}/oauth/token`, {
            method: 'POST',
            headers: buildForwardHeaders(req, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(req.body || {})
        });
        const data = await response.json();
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(response.status).json(data);
    } catch (err) {
        res.status(502).json({ error: 'server_error', error_description: err.message });
    }
});

app.get('/mcp', async (req, res) => {
    try {
        const qs = new URLSearchParams(req.query).toString();
        const response = await fetch(`${MAIN_SERVER_BASE}/mcp${qs ? `?${qs}` : ''}`, {
            headers: buildForwardHeaders(req)
        });
        const wwwAuth = response.headers.get('www-authenticate');
        if (wwwAuth) {
            res.setHeader('WWW-Authenticate', wwwAuth);
            res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
        }
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(502).json({ error: 'Main ThermalFlow server unreachable', details: err.message });
    }
});

app.post('/mcp', async (req, res) => {
    try {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
        const qs = new URLSearchParams(req.query).toString();
        const response = await fetch(`${MAIN_SERVER_BASE}/mcp${qs ? `?${qs}` : ''}`, {
            method: 'POST',
            headers: buildForwardHeaders(req, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(req.body)
        });
        const wwwAuth = response.headers.get('www-authenticate');
        if (wwwAuth) {
            res.setHeader('WWW-Authenticate', wwwAuth);
            res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
        }
        if (response.status === 202) {
            return res.status(202).end();
        }
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(502).json({ jsonrpc: '2.0', id: req.body?.id || null, error: { code: -32000, message: err.message } });
    }
});

app.options('/mcp', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.status(204).end();
});

app.delete('/mcp', async (req, res) => {
    try {
        const response = await fetch(`${MAIN_SERVER_BASE}/mcp`, {
            method: 'DELETE',
            headers: buildForwardHeaders(req)
        });
        const wwwAuth = response.headers.get('www-authenticate');
        if (wwwAuth) {
            res.setHeader('WWW-Authenticate', wwwAuth);
            res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
        }
        const data = await response.json().catch(() => ({ ok: true }));
        res.status(response.status).json(data);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// --- Initialize ---
// Load persisted queue on startup
const persistedJobs = loadQueue();
persistedJobs.forEach(job => {
    if (job.type === 'manifest') {
        addToQueue(
            () => performPrint(job.payload.title, job.payload.date, job.payload.tasks, job.payload.image, job.payload.template),
            job.type,
            job.payload
        );
    } else if (job.type === 'single') {
        addToQueue(
            () => performSinglePrint(job.payload.taskName),
            job.type,
            job.payload
        );
    }
});

app.listen(port, () => {
    logger.info(`ThermalFlow Print Server running on http://localhost:${port}`);
    logger.info(`Using VID: 0x4b8, PID: 0xe28`);
    logger.info(`Queue persistence: ${QUEUE_FILE}`);
});