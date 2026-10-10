// Shared checkout calculation: changes here affect receipts and payment amounts.
export function total(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export async function loadInventory(endpoint) {
  const response = await fetch(endpoint);
  if (!response.ok) { throw new Error('Inventory unavailable'); }
  return response.json();
}
