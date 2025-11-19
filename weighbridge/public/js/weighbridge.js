// Weighbridge - Shared JavaScript module for Web Serial API integration
// This module provides reusable functions for reading weight from serial port

frappe.provide('weighbridge');

weighbridge = {
    // Read weight from serial port and set value to specified field
    read_weight: async function(frm, target_field) {
        if (!('serial' in navigator)) {
            frappe.msgprint({
                title: __('Browser Not Supported'),
                indicator: 'red',
                message: __('Web Serial API is not supported in this browser. Please use Google Chrome.')
            });
            console.log('Web Serial API is not supported in this browser.');
            return;
        }

        let port = null;
        let reader = null;
        let keepReading = true;

        try {
            console.log('Requesting serial port...');

            // Prompt user to select a serial port
            port = await navigator.serial.requestPort();
            console.log('Serial port selected:', port);

            // Check if port is already open
            if (port.readable) {
                console.log('Port is already open, closing it first...');
                await port.close();
                // Small delay to ensure port is fully closed
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Open the serial port with baud rate 9600
            await port.open({ baudRate: 9600 });
            console.log('Serial port opened');

            frappe.show_alert({
                message: __('Reading weight from weighbridge...'),
                indicator: 'blue'
            }, 3);

            const textDecoder = new TextDecoder('ascii');
            reader = port.readable.getReader();

            console.log('Reading from serial port...');
            let byteBuffer = [];
            let lastWeight = null;
            let lastPrefix = null;
            let repeatCount = 0;
            let weightCaptured = false;

            // Number of consecutive identical stable weights required before we accept the value
            const repeatThreshold = 2;

            // Set a timeout to avoid infinite reading
            const timeoutId = setTimeout(() => {
                keepReading = false;
                if (reader) {
                    reader.cancel().catch(() => {});
                }
            }, 10000); // 10 second timeout

            try {
                while (keepReading) {
                    const { value, done } = await reader.read();
                    if (done) {
                        console.log('Reader done');
                        break;
                    }

                    if (!value || value.length === 0) {
                        continue;
                    }

                    // Append bytes to buffer
                    for (let i = 0; i < value.length; i++) {
                        byteBuffer.push(value[i]);
                    }

                    // Process complete frames delimited by 0x0d (carriage return)
                    let delimiterIndex = byteBuffer.indexOf(0x0d);
                    while (delimiterIndex !== -1) {
                        const frameBytes = byteBuffer.slice(0, delimiterIndex);
                        byteBuffer = byteBuffer.slice(delimiterIndex + 1);
                        delimiterIndex = byteBuffer.indexOf(0x0d);

                        if (frameBytes.length < 7) {
                            // Not a full frame (expecting prefix + 6 chars)
                            continue;
                        }

                        const prefix = frameBytes[0];
                        if (prefix !== 0x41 && prefix !== 0x43) {
                            // Unknown prefix
                            continue;
                        }

                        const weightText = textDecoder.decode(new Uint8Array(frameBytes.slice(1))).trim();
                        if (!weightText) {
                            continue;
                        }

                        const weightValue = parseFloat(weightText);
                        if (Number.isNaN(weightValue)) {
                            continue;
                        }

                        if (lastWeight !== null && lastWeight === weightValue && lastPrefix === prefix) {
                            repeatCount += 1;
                        } else {
                            lastWeight = weightValue;
                            lastPrefix = prefix;
                            repeatCount = 1;
                        }

                        console.log('Frame prefix:', prefix === 0x41 ? 'A' : 'C', 'weight:', weightValue, 'repeat count:', repeatCount);

                        // Only capture stable (prefix 'A') frames that repeat enough times
                        if (prefix === 0x41 && repeatCount >= repeatThreshold) {
                            frm.set_value(target_field, weightValue);

                            frappe.show_alert({
                                message: __('Weight captured: {0} kg', [weightValue]),
                                indicator: 'green'
                            }, 5);

                            weighbridge.calculate_net_weight(frm);

                            clearTimeout(timeoutId);
                            keepReading = false;
                            weightCaptured = true;
                            break;
                        }
                    }
                }
            } catch (readError) {
                console.log('Read error:', readError);
                throw readError;
            } finally {
                clearTimeout(timeoutId);
                if (reader) {
                    try {
                        await reader.cancel();
                        console.log('Reader cancelled');
                    } catch (cancelError) {
                        console.log('Reader cancel error:', cancelError);
                    }

                    try {
                        reader.releaseLock();
                        console.log('Reader released');
                    } catch (releaseError) {
                        console.log('Reader release error:', releaseError);
                    }

                    reader = null;
                }
            }

            if (!weightCaptured && keepReading === false) {
                throw new Error('Timeout: No weight data received within 10 seconds');
            }

        } catch (error) {
            console.log('Error:', error);
            frappe.msgprint({
                title: __('Error Reading Weight'),
                indicator: 'red',
                message: __('Error: {0}', [error.message || error])
            });
        } finally {
            // Always cleanup reader and port in the correct order
            try {
                if (port) {
                    await port.close();
                    console.log('Serial port closed');
                }
            } catch (cleanupError) {
                console.log('Cleanup error:', cleanupError);
                // Force close if there's an error
                try {
                    if (port) {
                        await port.close();
                    }
                } catch (e) {
                    console.log('Force close failed:', e);
                }
            }
        }
    },

    // Calculate net weight based on entry and exit weights
    calculate_net_weight: function(frm) {
        const entry_weight = frm.doc.entry_weight || 0;
        const exit_weight = frm.doc.exit_weight || 0;

        if (entry_weight > 0 && exit_weight > 0) {
            // Net weight is the absolute difference between entry and exit weights
            const net_weight = Math.abs(entry_weight - exit_weight);
            frm.set_value('net_weight', net_weight);
            console.log('Net weight calculated:', net_weight);
        }
    },

    // Setup weighbridge buttons for a form
    setup_weighbridge_buttons: function(frm) {
        // Setup Entry Weight Button
        if (frm.fields_dict.entry_weight_button && frm.fields_dict.entry_weight_button.$input) {
            frm.fields_dict.entry_weight_button.$input.off('click').on('click', async function() {
                await weighbridge.read_weight(frm, 'entry_weight');
            });
        }

        // Setup Exit Weight Button
        if (frm.fields_dict.exit_weight_button && frm.fields_dict.exit_weight_button.$input) {
            frm.fields_dict.exit_weight_button.$input.off('click').on('click', async function() {
                await weighbridge.read_weight(frm, 'exit_weight');
            });
        }
    }
};
