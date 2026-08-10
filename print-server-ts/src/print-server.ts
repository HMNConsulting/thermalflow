import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import winston from 'winston';

// escpos types are not available, using any
const escpos: any = require('escpos');

// --- Types ---
interface PrinterDevice {
    deviceDescriptor: {
        idVendor: number;
        idProduct: number;
    };
}

interface PrintJobPayload {
    title?: string;
    date?: string;
    tasks?: string[];
    image?: string;
    template?: string;
    taskName?: string;
    url?: string;
    data?: string;
    format?: string;
}

interface QueueItem {
    job: () => Promise<void>;
    resolve: () => void;
    reject: (err: Error) => void;
    type: 'manifest' | 'single' | 'qr' | 'barcode';
    payload: PrintJobPayload;
    retries: number;
}

interface PrinterStatus {
    connected: boolean;
    printerFound?: boolean;
    vendorId?: string | null;
    productId?: string | null;
    availablePrinters?: number;
    error?: string;
}

interface ImageValidationResult {
    valid: boolean;
    error?: string;
    buffer?: Buffer;
}

// --- Structured Logging ---
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'thermalflow-print-server' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// --- Compatibility Fix ---
const usbModule: any = require('usb');
if (!usbModule.on && usbModule.usb && usbModule.usb.on) {
    logger.info("[Compatibility] Patching 'usb' module for escpos-usb...");
    const target = usbModule.usb;
    usbModule.on = (...args: any[]) => target.on(...args);
    usbModule.emit = (...args: any[]) => target.emit(...args);
    usbModule.once = (...args: any[]) => target.once(...args);
    usbModule.removeListener = (...args: any[]) => target.removeListener(...args);
    usbModule.removeAllListeners = (event: string) => {
        if (event === 'detach') return;
        target.removeAllListeners(event);
    };
    if (!usbModule.findByIds && target.findByIds) {
        usbModule.findByIds = (...args: any[]) => target.findByIds(...args);
    }
}

// Load USB adapter
try {
    escpos.USB = require('escpos-usb');
} catch (e) {
    logger.warn("escpos-usb NOT FOUND");
}

const app = express();
const port = process.env.PRINT_SERVER_PORT || 3001;

// --- Rate Limiting ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(limiter);

// --- Queue Persistence ---
const QUEUE_FILE = path.join(__dirname, '..', 'print-queue.json');

function saveQueue(): void {
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

function loadQueue(): any[] {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        logger.error("Failed to load queue:", e);
    }
    return [];
}

// --- Printer Status ---
function checkPrinterStatus(): Promise<PrinterStatus> {
    return new Promise((resolve) => {
        try {
            if (typeof escpos.USB === 'undefined') {
                return resolve({ connected: false, error: 'escpos-usb not loaded' });
            }
            const printers: PrinterDevice[] = escpos.USB.findPrinter();
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
        } catch (e: any) {
            resolve({ connected: false, error: e.message });
        }
    });
}

// --- Print Queue ---
let printQueue: QueueItem[] = [];
let isProcessingQueue = false;

function processQueue(): void {
    if (isProcessingQueue || printQueue.length === 0) {
        if (printQueue.length === 0) saveQueue();
        return;
    }
    isProcessingQueue = true;

    const item = printQueue.shift()!;
    const { job, resolve, reject, type, payload, retries } = item;

    job()
        .then(() => {
            logger.info(`Print job completed: ${type}`, { payload: sanitizePayload(payload) });
            resolve();
        })
        .catch((err: Error) => {
            logger.error(`Print job failed: ${type}`, { error: err.message, retries });
            if (retries < 2) {
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

function sanitizePayload(payload: PrintJobPayload): PrintJobPayload {
    const sanitized = { ...payload };
    if (sanitized.image) sanitized.image = '[BASE64_IMAGE_REDACTED]';
    return sanitized;
}

function addToQueue(job: () => Promise<void>, type: QueueItem['type'], payload: PrintJobPayload): Promise<void> {
    return new Promise((resolve, reject) => {
        printQueue.push({ job, resolve, reject, type, payload, retries: 0 });
        saveQueue();
        processQueue();
    });
}

// --- Image Validation ---
function validateImage(imageStr?: string): ImageValidationResult {
    if (!imageStr) return { valid: true };
    if (typeof imageStr !== 'string') return { valid: false, error: 'Image must be a string' };
    if (imageStr.length > 2_000_000) return { valid: false, error: 'Image too large (max 2MB)' };

    const match = imageStr.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/);
    if (!match) return { valid: false, error: 'Invalid image data URI' };

    const format = match[1];
    if (format !== 'png') return { valid: false, error: `Unsupported format: ${format}. Only PNG.` };

    try {
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length === 0) return { valid: false, error: 'Empty image buffer' };
        if (buffer[0] !== 0x89 || buffer[1] !== 0x50) return { valid: false, error: 'Invalid PNG signature' };
        return { valid: true, buffer };
    } catch (e: any) {
        return { valid: false, error: `Decode failed: ${e.message}` };
    }
}

// --- Templates ---
type TemplateFunction = (printer: any, title?: string, date?: string, tasks?: string[], imageStr?: string) => void;

const templates: Record<string, TemplateFunction> = {
    default: (printer, title, date, tasks) => {
        printer.font('a').align('ct').style('b').size(1, 1)
            .text(title || 'THERMALFLOW')
            .size(0, 0).style('normal')
            .text(date || new Date().toLocaleString())
            .text('--------------------------------').align('lt');
        tasks?.forEach(t => printer.text(t));
    },
    minimal: (printer, title, _date, tasks) => {
        printer.font('a').align('lt').text(title || 'NOTE').text('---');
        tasks?.forEach(t => printer.text(`• ${t}`));
    },
    receipt: (printer, title, date, tasks) => {
        printer.font('a').align('ct').style('b').text(title || 'RECEIPT')
            .style('normal').text(date || new Date().toLocaleString())
            .text('================================').align('lt');
        tasks?.forEach(t => printer.text(`  ${t}`));
        printer.text('================================');
    }
};

function getTemplate(name?: string): TemplateFunction {
    return templates[name || 'default'] || templates.default;
}

// --- Print Functions ---
function performPrint(title?: string, date?: string, tasks?: string[], imageStr?: string, templateName?: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            let device: any;
            const printers: PrinterDevice[] = escpos.USB.findPrinter();

            if (printers?.length > 0) {
                const target = printers.find(p =>
                    p.deviceDescriptor.idVendor === 0x4b8 && p.deviceDescriptor.idProduct === 0xe28
                );
                device = new escpos.USB(target || printers[0]);
            } else {
                device = new escpos.USB(0x4b8, 0xe28);
            }

            const printer = new escpos.Printer(device, { encoding: "GB18030" });

            device.open((error: Error | null) => {
                if (error) {
                    logger.error("Printer Connection Error:", error);
                    return reject(new Error('Printer not ready'));
                }

                if (imageStr) {
                    const validation = validateImage(imageStr);
                    if (!validation.valid) {
                        device.close();
                        return reject(new Error(validation.error));
                    }
                }

                const template = getTemplate(templateName);

                if (imageStr) {
                    const base64Data = imageStr.replace(/^data:image\/png;base64,/, "");
                    const buffer = Buffer.from(base64Data, 'base64');
                    escpos.Image.load(buffer, 'image/png', (img: any) => {
                        if (!img) return closePrinter();
                        template(printer, title, date, tasks, imageStr);
                        printer.align('ct').raster(img)
                            .text('--------------------------------').feed(1).align('ct')
                            .text('END OF TRANSMISSION').feed(3).cut()
                            .close(() => resolve());
                    });
                    return;
                }

                template(printer, title, date, tasks, imageStr);
                closePrinter();

                function closePrinter() {
                    printer.text('--------------------------------').feed(1).align('ct')
                        .text('END OF TRANSMISSION').feed(3).cut()
                        .close(() => resolve());
                }
            });
        } catch (e: any) {
            logger.error("USB Init Failed:", e.message);
            reject(new Error('Printer device not found'));
        }
    });
}

function performSinglePrint(taskName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            let device: any;
            const printers: PrinterDevice[] = escpos.USB.findPrinter();
            if (printers?.length > 0) {
                const target = printers.find(p =>
                    p.deviceDescriptor.idVendor === 0x4b8 && p.deviceDescriptor.idProduct === 0xe28
                );
                device = new escpos.USB(target || printers[0]);
            } else {
                device = new escpos.USB(0x4b8, 0xe28);
            }

            const printer = new escpos.Printer(device, { encoding: "GB18030" });

            device.open((error: Error | null) => {
                if (error) return reject(new Error('Printer not ready'));
                printer.font('a').align('ct').style('b').size(1, 1)
                    .text('------------------------').feed(1).size(2, 2)
                    .text(taskName).size(1, 1).feed(1)
                    .text('------------------------').feed(2).cut()
                    .close(() => resolve());
            });
        } catch (e: any) {
            reject(new Error('Printer device not found'));
        }
    });
}

function performBarcodePrint(data: string, format: string, title?: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            let device: any;
            const printers: PrinterDevice[] = escpos.USB.findPrinter();
            if (printers?.length > 0) {
                const target = printers.find(p =>
                    p.deviceDescriptor.idVendor === 0x4b8 && p.deviceDescriptor.idProduct === 0xe28
                );
                device = new escpos.USB(target || printers[0]);
            } else {
                device = new escpos.USB(0x4b8, 0xe28);
            }

            const printer = new escpos.Printer(device, { encoding: "GB18030" });

            device.open((error: Error | null) => {
                if (error) return reject(new Error('Printer not ready'));
                printer.font('a').align('ct').style('b')
                    .text(title || 'BARCODE').style('normal')
                    .text('--------------------------------');
                try {
                    printer.barcode(data, format, { width: 2, height: 100 });
                } catch (e) {
                    printer.text(data);
                }
                printer.text('--------------------------------').feed(3).cut()
                    .close(() => resolve());
            });
        } catch (e: any) {
            reject(new Error('Printer device not found'));
        }
    });
}

// --- API Endpoints ---

app.get('/health', async (_req: Request, res: Response) => {
    const printerStatus = await checkPrinterStatus();
    res.json({
        status: 'alive',
        usbAvailable: typeof escpos.USB !== 'undefined',
        printer: printerStatus,
        queueLength: printQueue.length,
        message: `Printer server is running on port ${port}`
    });
});

app.get('/printer-status', async (_req: Request, res: Response) => {
    res.json(await checkPrinterStatus());
});

app.get('/queue', (_req: Request, res: Response) => {
    res.json({
        length: printQueue.length,
        isProcessing: isProcessingQueue,
        jobs: printQueue.map(j => ({ type: j.type, retries: j.retries }))
    });
});

app.post('/print', async (req: Request, res: Response) => {
    const { title, date, tasks, image, template }: PrintJobPayload = req.body;

    if (title && (typeof title !== 'string' || title.length > 100)) {
        return res.status(400).json({ error: 'Invalid title' });
    }
    if (date && (typeof date !== 'string' || date.length > 50)) {
        return res.status(400).json({ error: 'Invalid date' });
    }
    if (tasks && (!Array.isArray(tasks) || tasks.some(t => typeof t !== 'string' || t.length > 200))) {
        return res.status(400).json({ error: 'Invalid tasks' });
    }
    if (tasks && tasks.length > 50) {
        return res.status(400).json({ error: 'Too many tasks' });
    }
    if (image) {
        const validation = validateImage(image);
        if (!validation.valid) return res.status(400).json({ error: validation.error });
    }

    try {
        await addToQueue(() => performPrint(title, date, tasks, image, template), 'manifest', { title, tasks, image, template });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/print-single', async (req: Request, res: Response) => {
    const { taskName }: { taskName?: string } = req.body;

    if (!taskName || typeof taskName !== 'string' || taskName.trim().length === 0) {
        return res.status(400).json({ error: 'taskName required' });
    }
    if (taskName.length > 200) {
        return res.status(400).json({ error: 'taskName too long' });
    }

    try {
        await addToQueue(() => performSinglePrint(taskName.trim()), 'single', { taskName });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/print-qr', async (req: Request, res: Response) => {
    const { url, title }: { url?: string; title?: string } = req.body;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url required' });
    }
    if (url.length > 500) {
        return res.status(400).json({ error: 'url too long' });
    }

    try {
        const qrBuffer = await QRCode.toBuffer(url, { type: 'png', width: 300, margin: 2 });
        const dataUri = `data:image/png;base64,${qrBuffer.toString('base64')}`;
        await addToQueue(() => performPrint(title || 'QR CODE', new Date().toLocaleString(), [url], dataUri, 'default'), 'qr', { url, title });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: 'QR generation failed' });
    }
});

app.post('/print-barcode', async (req: Request, res: Response) => {
    const { data, format = 'CODE128', title }: { data?: string; format?: string; title?: string } = req.body;

    if (!data || typeof data !== 'string') {
        return res.status(400).json({ error: 'data required' });
    }

    try {
        await addToQueue(() => performBarcodePrint(data, format, title), 'barcode', { data, format, title });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Init ---
const persistedJobs = loadQueue();
persistedJobs.forEach(job => {
    if (job.type === 'manifest') {
        addToQueue(() => performPrint(job.payload.title, job.payload.date, job.payload.tasks, job.payload.image, job.payload.template), job.type, job.payload);
    } else if (job.type === 'single') {
        addToQueue(() => performSinglePrint(job.payload.taskName!), job.type, job.payload);
    }
});

app.listen(port, () => {
    logger.info(`ThermalFlow Print Server running on http://localhost:${port}`);
});