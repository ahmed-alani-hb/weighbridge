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

        try {
            console.log('Requesting serial port...');

            // Prompt user to select a serial port
            const port = await navigator.serial.requestPort();
            console.log('Serial port selected:', port);

            // Open the serial port with baud rate 9600
            await port.open({ baudRate: 9600 });
            console.log('Serial port opened');

            frappe.show_alert({
                message: __('Reading weight from weighbridge...'),
                indicator: 'blue'
            }, 3);

            const textDecoder = new TextDecoderStream();
            const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
            const reader = textDecoder.readable.getReader();

            console.log('Reading from serial port...');
            let receivedData = '';
            let weight_found = false;

            // Set a timeout to avoid infinite reading
            const timeout = setTimeout(async () => {
                if (!weight_found) {
                    reader.releaseLock();
                    await port.close();
                    frappe.msgprint({
                        title: __('Timeout'),
                        indicator: 'orange',
                        message: __('No weight data received within timeout period. Please try again.')
                    });
                }
            }, 10000); // 10 second timeout

            while (!weight_found) {
                const { value, done } = await reader.read();
                if (done) {
                    reader.releaseLock();
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

                        weight_found = true;
                        clearTimeout(timeout);

                        frappe.show_alert({
                            message: __('Weight captured: {0} kg', [weight]),
                            indicator: 'green'
                        }, 5);

                        // Calculate net weight if both entry and exit weights are available
                        weighbridge.calculate_net_weight(frm);
                    }
                    receivedData = ''; // Clear the receivedData for the next message
                }
            }

            await readableStreamClosed.catch(() => { /* Ignore the error */ });
            await port.close();
            console.log('Serial port closed');

        } catch (error) {
            console.log('Error:', error);
            frappe.msgprint({
                title: __('Error Reading Weight'),
                indicator: 'red',
                message: __('Error: {0}', [error.message || error])
            });
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
