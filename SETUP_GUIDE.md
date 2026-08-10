# ThermalFlow Setup Guide

## Prerequisites
- Node.js (v18+)
- Thermal Receipt Printer (Epson TM-T20III or compatible ESC/POS USB printer)
- Windows OS (Specific instructions for USB drivers included)

## 1. Installation

Install project dependencies:
```bash
npm install
```

## 2. Running the App (Frontend)

Start the Next.js frontend:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## 3. Setting Up the Thermal Printer

**IMPORTANT for WINDOWS Users:** 
Node.js text-to-printer libraries often require `libusb` drivers to access USB devices directly. The default Windows printer drivers usually block this direct access.

### Step A: Install Zadig
1. Download [Zadig](https://zadig.akeo.ie/).
2. Plug in your Thermal Printer via USB.
3. Open Zadig.
4. Options -> List All Devices.
5. Select your Printer (e.g., "TM-T20III").
6. Change the driver in the right box to **WinUSB** (v6.1 or similar).
7. Click "Replace Driver" (or "Install Driver").
   - *Warning: This will make the printer unavailable to standard Windows "Print" dialogs. To revert, uninstall the device in Device Manager and re-plug it.*

### Step B: Run the App
You can now start both the main application and the print server with a single command:

```bash
npm start
```
(Or `npm run dev` for development mode).

If the printer is detected, you will see `ThermalFlow Print Server running...`.

## 4. Setting Up the Thermal Printer (Ubuntu/Linux)

Direct USB access on Linux requires permissions and handling kernel driver conflicts.

### Step A: Install Dependencies
```bash
sudo apt update
sudo apt install libusb-1.0-0-dev pkg-config
```

### Step B: Create udev Rule
Create a rule to allow standard users to access the printer:
1. Open a new rule file: `sudo nano /etc/udev/rules.d/99-escpos.rules`
2. Paste the following line (assuming Epson VID 0x04b8):
   ```
   SUBSYSTEM=="usb", ATTR{idVendor}=="04b8", MODE="0666", GROUP="dialout"
   ```
3. Save and exit (Ctrl+O, Enter, Ctrl+X).
4. Reload rules:
   ```bash
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```

### Step C: Disable Kernel Printer Driver
Linux often attaches the `usblp` driver which blocks Node.js access. You can disable it temporarily:
```bash
sudo modprobe -r usblp
```
(To make this permanent, blacklist it in `/etc/modprobe.d/blacklist.conf`).

## 5. Usage

1. **Add Tasks**: Use the input at the bottom of a column.
2. **Navigate**: Click tasks to drill down (Miller Columns).
3. **Print**: Click the "PRINT" button in the top-right.
   - If the server is **RUNNING** and printer is **CONNECTED**, it will print a receipt.
   - If the server is **DOWN** or printer is **MISSING**, the app will simulate the print with audio/visual effects.

## Troubleshooting

- **Printer not found**: Check USB connection and ensure Zadig WinUSB driver is installed.
- **Server crashing**: Ensure `escpos-usb` is installed (`npm install escpos-usb`).
- **Layout issues**: Ensure browser window is wide enough for horizontal scrolling.

    NEXT_PUBLIC_PRINT_SERVER_URL=https://your-print-tunnel.trycloudflare.com
    
