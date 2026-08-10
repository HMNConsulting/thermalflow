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

// --- Rate Limiting ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
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

// --- Print Templates ---
const templates = {
    default: (printer, title, date, tasks, imageStr) => {
        printer
            .font('a')
            .align('ct')
            .style('b')
            .size(1, 1)
            .text(title || 'THERMALFLOW')
            .size(0, 0)
            .style('normal')
            .text(date || new Date().toLocaleString())
            .text('--------------------------------')
            .align('lt');

        if (tasks && Array.isArray(tasks)) {
            tasks.forEach(task => printer.text(task));
        }
    },
    minimal: (printer, title, date, tasks, imageStr) => {
        printer
            .font('a')
            .align('lt')
            .text(title || 'NOTE')
            .text('---');
        if (tasks && Array.isArray(tasks)) {
            tasks.forEach(task => printer.text(`• ${task}`));
        }
    },
    receipt: (printer, title, date, tasks, imageStr) => {
        printer
            .font('a')
            .align('ct')
            .style('b')
            .text(title || 'RECEIPT')
            .style('normal')
            .text(date || new Date().toLocaleString())
            .text('================================')
            .align('lt');
        if (tasks && Array.isArray(tasks)) {
            tasks.forEach(task => printer.text(`  ${task}`));
        }
        printer.text('================================');
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

            const options = { encoding: "GB18030" };
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
                                .text('--------------------------------')
                                .feed(1)
                                .align('ct')
                                .text('END OF TRANSMISSION')
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
                        .text('--------------------------------')
                        .feed(1)
                        .align('ct')
                        .text('END OF TRANSMISSION')
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
function performSinglePrint(taskName) {
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

            const options = { encoding: "GB18030" };
            const printer = new escpos.Printer(device, options);

            device.open(function (error) {
                if (error) {
                    logger.error("Printer Connection Error:", error);
                    return reject(new Error('Printer not ready'));
                }

                logger.info(`Printing individual task: ${taskName}`);

                printer
                    .font('a')
                    .align('ct')
                    .style('b')
                    .size(1, 1)
                    .text('------------------------')
                    .feed(1)
                    .size(2, 2)
                    .text(taskName)
                    .size(1, 1)
                    .feed(1)
                    .text('------------------------')
                    .feed(2)
                    .cut()
                    .close(() => {
                        logger.info("Single Print Success");
                        resolve();
                    });
            });

        } catch (e) {
            logger.error("USB Device Initialization Failed:", e.message);
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
    const { taskName } = req.body;

    // Input validation
    if (!taskName || typeof taskName !== 'string' || taskName.trim().length === 0) {
        return res.status(400).json({ error: 'taskName is required and must be a non-empty string' });
    }
    if (taskName.length > 200) {
        return res.status(400).json({ error: 'taskName too long: max 200 chars' });
    }

    logger.info(`Queueing Single Print: ${taskName}`);

    try {
        await addToQueue(
            () => performSinglePrint(taskName.trim()),
            'single',
            { taskName: taskName.substring(0, 50) }
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

            const options = { encoding: "GB18030" };
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