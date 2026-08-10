const escpos = require('escpos');
try {
    escpos.USB = require('escpos-usb');
} catch (e) {
    console.error("escpos-usb not found. Please run: npm install escpos-usb");
    process.exit(1);
}

console.log("--- ThermalFlow USB Diagnostic ---");

const usb = require('usb');
console.log("- usb module type:", typeof usb);
console.log("- usb has .on:", typeof usb.on === 'function');
console.log("- usb.usb has .on:", usb.usb && typeof usb.usb.on === 'function');
console.log("- usb has .findByIds:", typeof usb.findByIds === 'function');
console.log("- usb.usb has .findByIds:", usb.usb && typeof usb.usb.findByIds === 'function');

try {

    // Attempt to find all devices
    const devices = escpos.USB.findPrinter();

    if (!devices || devices.length === 0) {
        console.log("No USB printers detected via escpos.USB.findPrinter().");
        console.log("Checking all USB devices...");

        // Use the underlying node-usb if available to see EVERYTHING
        const usb = require('usb');
        const allDevices = usb.getDeviceList();

        console.log(`Found ${allDevices.length} total USB devices:`);
        allDevices.forEach((dev, i) => {
            const desc = dev.deviceDescriptor;
            console.log(`[${i}] VID: 0x${desc.idVendor.toString(16).padStart(4, '0')}, PID: 0x${desc.idProduct.toString(16).padStart(4, '0')}`);
        });

        console.log("\nACTION REQUIRED: Assign the 'WinUSB' driver to your printer using Zadig.");
    } else {
        console.log(`Found ${devices.length} potential printers:`);
        devices.forEach((dev, i) => {
            console.log(`[${i}] VID: 0x${dev.deviceDescriptor.idVendor.toString(16)}, PID: 0x${dev.deviceDescriptor.idProduct.toString(16)}`);
            console.log(`    - Has .on (EventEmitter): ${typeof dev.on === 'function'}`);
            console.log(`    - Has .open: ${typeof dev.open === 'function'}`);
        });
    }

    // Attempt a manual look up of the user's hardcoded ID
    console.log("\n--- Testing Target device (0x4b8, 0xe28) ---");
    try {
        const testDev = new escpos.USB(0x4b8, 0xe28);
        console.log("Device object created.");
        console.log("- .on exists:", typeof testDev.on === 'function');
        console.log("- .open exists:", typeof testDev.open === 'function');
        if (!testDev.on) {
            console.log("WARNING: Device object is missing EventEmitter methods. This usually means initialization failed or there's a version mismatch.");
        }
    } catch (e) {
        console.log("Error creating test device:", e.message);
    }

} catch (err) {
    console.error("CRITICAL ERROR DURING DIAGNOSIS:");
    console.error(err.message);
    if (err.message.includes("on is not a function")) {
        console.log("\nNOTE: This error usually means the USB library failed to find a valid device interface.");
    }
}
