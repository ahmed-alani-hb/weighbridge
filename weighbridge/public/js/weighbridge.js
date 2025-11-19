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
        let readableStreamClosed = null;
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

            const textDecoder = new TextDecoderStream();
            readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
            reader = textDecoder.readable.getReader();

            console.log('Reading from serial port...');
            let receivedData = '';

            // Set a timeout to avoid infinite reading
            const timeoutId = setTimeout(() => {
                keepReading = false;
                reader.cancel().catch(() => {});
            }, 10000); // 10 second timeout

            try {
                while (keepReading) {
                    const { value, done } = await reader.read();
                    if (done) {
                        console.log('Reader done');
                        break;
                    }

                    // Append the received chunk to the receivedData
                    receivedData += value;
                    console.log('Partial data received:', value);

                    // Check if the receivedData contains the complete message
                    if (receivedData.includes('\n')) {
                        const completeData = receivedData.trim();
                        console.log('Complete data received:', completeData);

                        // Extract the weight from the complete data
                        // Pattern matches formats like ",+12345kg" or similar
                        const weightMatch = completeData.match(/[,\s]\+?(\d+(?:\.\d+)?)\s*kg/i);
                        if (weightMatch) {
                            const weight = parseFloat(weightMatch[1]);
                            console.log('Extracted weight:', weight);

                            // Set the extracted weight in the target field
                            frm.set_value(target_field, weight);

                            frappe.show_alert({
                                message: __('Weight captured: {0} kg', [weight]),
                                indicator: 'green'
                            }, 5);

                            // Calculate net weight if both entry and exit weights are available
                            weighbridge.calculate_net_weight(frm);

                            clearTimeout(timeoutId);
                            keepReading = false; // Exit the loop
                            break;
                        }
                        receivedData = ''; // Clear the receivedData for the next message
                    }
                }
            } catch (readError) {
                console.log('Read error:', readError);
                throw readError;
            } finally {
                clearTimeout(timeoutId);
            }

            if (!receivedData.match(/\d+/) && keepReading === false) {
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
                if (reader) {
                    try {
                        // Always cancel the reader before releasing the lock to avoid
                        // "Releasing Default Reader" errors that surface in browsers
                        // when a stream is still locked.
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
                }
                if (readableStreamClosed) {
                    await readableStreamClosed.catch(() => { /* Ignore errors */ });
                    console.log('Stream closed');
                }
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
