import assert from 'node:assert/strict';
import { total } from './cart.mjs';

assert.equal(total([]), 0);
assert.equal(total([{ price: 25, quantity: 3 }]), 75, 'Quantity must affect payment');
assert.equal(total([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }]), 25);
console.log('Checkout checks passed.');
