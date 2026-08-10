const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const escpos = require('escpos');

// Compatibility Fix: escpos-usb expects the 'usb' module to be an EventEmitter
// with .on and .findByIds. Newer versions of the 'usb' module (v2+) have shifted
// these to a .usb property.
const usbModule = require('usb');
if (!usbModule.on && usbModule.usb && usbModule.usb.on) {
    console.log("[Compatibility] Patching 'usb' module for escpos-usb...");
    const target = usbModule.usb;
    // Surgically assign instead of Object.assign to avoid read-only errors
    usbModule.on = (...args) => target.on(...args);
    usbModule.emit = (...args) => target.emit(...args);
    usbModule.once = (...args) => target.once(...args);
    usbModule.removeListener = (...args) => target.removeListener(...args);
    usbModule.removeAllListeners = (event) => {
        if (event === 'detach') {
            // escpos-usb has a bug where it removes ALL global detach listeners on close().
            // We ignore this to keep the usb module state consistent.
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
    console.warn("escpos-usb NOT FOUND. Please install it: npm install escpos-usb");
}

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());

// Health Check / Diagnostics
app.get('/health', (req, res) => {
    res.json({
        status: 'alive',
        usbAvailable: typeof escpos.USB !== 'undefined',
        message: 'Printer server is running on port 3001'
    });
});

// --- Printer Queue Logic ---
const printQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || printQueue.length === 0) return;
    isProcessingQueue = true;

    const { job, resolve, reject } = printQueue.shift();
    try {
        await job();
        resolve();
    } catch (err) {
        console.error("Print job error:", err);
        reject(err);
    } finally {
        isProcessingQueue = false;
        // Small delay to let USB/Printer settle before next job
        setTimeout(processQueue, 1000);
    }
}

function addToQueue(job) {
    return new Promise((resolve, reject) => {
        printQueue.push({ job, resolve, reject });
        processQueue();
    });
}

// Helper function to perform a print job
function performPrint(title, date, tasks, imageStr) {
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
                    console.log(`Found target printer: VID 0x${target.deviceDescriptor.idVendor.toString(16)}, PID 0x${target.deviceDescriptor.idProduct.toString(16)}`);
                    device = new escpos.USB(target);
                } else {
                    console.log(`Using first available printer (VID 0x${printers[0].deviceDescriptor.idVendor.toString(16)}).`);
                    device = new escpos.USB(printers[0]);
                }
            } else {
                console.log("Falling back to hardcoded VID/PID...");
                device = new escpos.USB(0x4b8, 0xe28);
            }

            const options = { encoding: "GB18030" };
            const printer = new escpos.Printer(device, options);

            device.open(function (error) {
                if (error) {
                    console.error("Printer Connection Error:", error);
                    return reject(new Error('Printer not ready'));
                }

                console.log("Printer Connected. Printing...");

                if (imageStr) {
                    try {
                        const base64Data = imageStr.replace(/^data:image\/png;base64,/, "");
                        const buffer = Buffer.from(base64Data, 'base64');
                        escpos.Image.load(buffer, 'image/png', function (img) {
                            if (!img) {
                                console.log("Failed to load image buffer");
                                return closePrinter();
                            }
                            printer
                                .font('a')
                                .align('ct')
                                .style('b')
                                .size(1, 1)
                                .text(title || 'THERMALFLOW')
                                .size(0, 0)
                                .style('normal')
                                .text(date || new Date().toLocaleString())
                                .text('--------------------------------');

                            if (tasks && Array.isArray(tasks)) {
                                printer.align('lt');
                                tasks.forEach(task => {
                                    printer.text(task);
                                });
                            }

                            // Print the image
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
                                    console.log("Print Success (with image)");
                                    resolve();
                                });
                        });
                        return; // Async image loading handles the rest
                    } catch (err) {
                        console.error("Error processing image:", err);
                    }
                }

                // Normal Text Print (No Image)
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
                    tasks.forEach(task => {
                        printer.text(task);
                    });
                }

                function closePrinter() {
                    printer
                        .text('--------------------------------')
                        .feed(1)
                        .align('ct')
                        .text('END OF TRANSMISSION')
                        .feed(3)
                        .cut()
                        .close(() => {
                            console.log("Print Success");
                            resolve();
                        });
                }

                closePrinter();
            });

        } catch (e) {
            console.error("USB Device Initialization Failed:", e.message);
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
                    console.error("Printer Connection Error:", error);
                    return reject(new Error('Printer not ready'));
                }

                console.log(`Printing individual task: ${taskName}`);

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
                        console.log("Single Print Success");
                        resolve();
                    });
            });

        } catch (e) {
            console.error("USB Device Initialization Failed:", e.message);
            reject(new Error('Printer device not found'));
        }
    });
}

app.post('/print', async (req, res) => {
    const { title, date, tasks, image } = req.body;
    console.log(`Queueing Manifest Print: ${title} (${tasks ? tasks.length : 0} tasks) ${image ? '[IMAGE INCLUDED]' : ''}`);

    try {
        await addToQueue(() => performPrint(title, date, tasks, image));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/print-single', async (req, res) => {
    const { taskName } = req.body;
    console.log(`Queueing Single Print: ${taskName}`);

    try {
        await addToQueue(() => performSinglePrint(taskName));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`ThermalFlow Print Server running on http://localhost:${port}`);
    console.log(`Using VID: 0x4b8, PID: 0xe28`);

    // Perform startup test print
    // console.log("Attempting startup test print...");
    // performPrint("STARTUP TEST", new Date().toLocaleString(), ["Initialization successful", "Printer is ONLINE"]);
});
