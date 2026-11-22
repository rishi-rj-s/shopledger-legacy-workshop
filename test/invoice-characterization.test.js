'use strict';

var assert = require('node:assert/strict');
var test = require('node:test');

var invoice = require('../lib/invoice');
var pricing = require('../lib/pricing');

// These are in-memory order/item values shaped like the records passed between
// the order route, the pricing module, and the invoice renderer. No store I/O.
function order(items, coupon, total) {
  return {
    id: 1234,
    date: '22/11/2026',
    customer: 'Test Customer',
    paymentMode: 'cash',
    status: 'completed',
    items: items,
    coupon: coupon || '',
    total: total
  };
}

test('CURRENT BEHAVIOUR: order pricing applies HSN rates and a coupon before GST', function () {
  var items = [
    { id: 1, name: 'Rice', hsn: '1006', price: 400, qty: 1 },
    { id: 2, name: 'Tea', hsn: '0902', price: 200, qty: 1 }
  ];

  var totals = pricing.computeTotals(items, 'SAVE10');

  assert.deepEqual({
    subtotal: totals.subtotal,
    discount: totals.discount,
    taxable: totals.taxable,
    tax: totals.tax,
    cgst: totals.cgst,
    sgst: totals.sgst,
    total: totals.total
  }, {
    subtotal: 600,
    discount: 60,
    taxable: 540,
    tax: 50.4,
    cgst: 25.2,
    sgst: 25.2,
    total: 590.4
  });
  assert.deepEqual(totals.lines.map(function (line) {
    return { gstPercent: line.gstPercent, discount: line.discount, taxable: line.taxable, tax: line.tax };
  }), [
    { gstPercent: 5, discount: 40, taxable: 360, tax: 18 },
    { gstPercent: 18, discount: 20, taxable: 180, tax: 32.4 }
  ]);
});

test('Invoice figures match the billed rice order with SAVE10', function () {
  var items = [
    { id: 1, name: 'Indrayani Basmati Rice 5kg', sku: 'GRN-001', hsn: '1006', price: 640, qty: 1 }
  ];
  var billed = pricing.computeTotals(items, 'SAVE10');
  var figures = invoice.computeInvoiceFigures(order(items, 'SAVE10', billed.total));

  assert.equal(figures.subtotal, billed.subtotal);
  assert.equal(figures.discount, billed.discount);
  assert.equal(figures.tax, billed.tax);
  assert.equal(figures.cgst, billed.cgst);
  assert.equal(figures.sgst, billed.sgst);
  assert.equal(figures.total, billed.total);
});

test('Invoice GST and total match pricing for mixed HSN lines', function () {
  var items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 400, qty: 1 },
    { id: 2, name: 'Tea', sku: 'BEV-001', hsn: '0902', price: 200, qty: 1 }
  ];

  var billed = pricing.computeTotals(items, '');
  var figures = invoice.computeInvoiceFigures(order(items, '', billed.total));

  assert.equal(figures.subtotal, billed.subtotal);
  assert.equal(figures.tax, billed.tax);
  assert.equal(figures.cgst, billed.cgst);
  assert.equal(figures.sgst, billed.sgst);
  assert.equal(figures.total, billed.total);
  assert.deepEqual(figures.rows.map(function (line) { return line.gstPercent; }), [5, 18]);
  assert.deepEqual(figures.rows.map(function (line) { return line.lineTax; }), billed.lines.map(function (line) { return line.tax; }));
});

test('Invoice percentage coupon matches the amount billed by pricing', function () {
  var items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 600, qty: 1 }
  ];

  var ledger = pricing.computeTotals(items, 'SAVE10');
  var figures = invoice.computeInvoiceFigures(order(items, 'SAVE10', ledger.total));

  assert.equal(figures.discount, ledger.discount);
  assert.equal(figures.tax, ledger.tax);
  assert.equal(figures.total, ledger.total);
});

test('Invoice percentage coupon respects the pricing discount cap', function () {
  var items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 3000, qty: 1 }
  ];

  var ledger = pricing.computeTotals(items, 'SAVE10');
  var figures = invoice.computeInvoiceFigures(order(items, 'SAVE10', ledger.total));

  assert.equal(ledger.discount, 150);
  assert.equal(figures.discount, ledger.discount);
  assert.equal(figures.tax, ledger.tax);
  assert.equal(figures.total, ledger.total);
});

test('Invoice line GST matches the post-discount taxable amount', function () {
  var items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 600, qty: 1 }
  ];

  var figures = invoice.computeInvoiceFigures(order(items, 'SAVE10', 567));
  var rendered = invoice.render(order(items, 'SAVE10', 567));

  assert.equal(figures.rows[0].lineTax, 27);
  assert.equal(figures.discount, 60);
  assert.match(rendered, /GST Amt<\/th>/);
  assert.doesNotMatch(rendered, /Accountant Reconciliation Notice/);
});

test('Invoice GST rate follows the pricing resolver, including explicit zero rate', function () {
  var explicit = invoice.computeInvoiceFigures(order([
    { id: 1, name: 'Rice', hsn: '1006', gstRate: 5, price: 100, qty: 1 }
  ], '', 105));
  var zero = invoice.computeInvoiceFigures(order([
    { id: 1, name: 'Rice', hsn: '1006', gstRate: 0, price: 100, qty: 1 }
  ], '', 100));

  assert.equal(explicit.rows[0].gstPercent, 5);
  assert.equal(explicit.tax, 5);
  assert.equal(zero.rows[0].gstPercent, 0);
  assert.equal(zero.tax, 0);
});
