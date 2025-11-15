// Weighbridge integration for Purchase Receipt
frappe.ui.form.on('Purchase Receipt', {
    refresh: function(frm) {
        // Setup weighbridge buttons when form is refreshed
        if (typeof weighbridge !== 'undefined' && weighbridge.setup_weighbridge_buttons) {
            weighbridge.setup_weighbridge_buttons(frm);
        }
    },

    entry_weight: function(frm) {
        // Recalculate net weight when entry weight changes
        if (typeof weighbridge !== 'undefined' && weighbridge.calculate_net_weight) {
            weighbridge.calculate_net_weight(frm);
        }
    },

    exit_weight: function(frm) {
        // Recalculate net weight when exit weight changes
        if (typeof weighbridge !== 'undefined' && weighbridge.calculate_net_weight) {
            weighbridge.calculate_net_weight(frm);
        }
    }
});
