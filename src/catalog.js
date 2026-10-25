'use strict';
// A small demo catalog. In a real deployment this would be a product-search API.
// The agent can only choose among items returned here, and prices always come from here
// (never from the AI), so the AI cannot invent a price.

const CATALOG = [
  { id: 'e-001', title: 'USB-C 7-in-1 Hub (HDMI, SD, 100W PD)', price: 29.99, category: 'electronics', merchant: 'NorthDock', tags: ['usb-c', 'hub', 'dock', 'laptop', 'hdmi'] },
  { id: 'e-002', title: 'USB-C 4-port Hub, compact', price: 18.49, category: 'electronics', merchant: 'PortPal', tags: ['usb-c', 'hub', 'dock', 'laptop'] },
  { id: 'e-003', title: 'Wireless Mouse, silent clicks', price: 14.99, category: 'electronics', merchant: 'ClickCo', tags: ['mouse', 'wireless', 'silent'] },
  { id: 'e-004', title: 'Mechanical Keyboard, 75% layout', price: 64.0, category: 'electronics', merchant: 'KeyForge', tags: ['keyboard', 'mechanical'] },
  { id: 'e-005', title: 'Noise-Cancelling Headphones', price: 119.0, category: 'electronics', merchant: 'SoundArc', tags: ['headphones', 'noise', 'audio'] },
  { id: 'e-006', title: 'Webcam 1080p with privacy shutter', price: 34.5, category: 'electronics', merchant: 'ClearView', tags: ['webcam', 'camera', 'video'] },
  { id: 'e-007', title: '65W USB-C Charger (GaN)', price: 22.9, category: 'electronics', merchant: 'VoltEdge', tags: ['charger', 'usb-c', 'gan', 'power'] },
  { id: 'o-001', title: 'A4 Notebook, dotted, 3-pack', price: 11.5, category: 'office', merchant: 'PaperTrail', tags: ['notebook', 'paper', 'a4'] },
  { id: 'o-002', title: 'Gel Pens, 12 colors', price: 7.25, category: 'office', merchant: 'PaperTrail', tags: ['pen', 'pens', 'gel'] },
  { id: 'o-003', title: 'Ergonomic Desk Lamp, LED', price: 31.0, category: 'office', merchant: 'BrightHome', tags: ['lamp', 'desk', 'led'] },
  { id: 'o-004', title: 'Monitor Stand with storage', price: 39.9, category: 'office', merchant: 'DeskWorks', tags: ['monitor', 'stand', 'desk'] },
  { id: 'b-001', title: 'The Pragmatic Programmer (paperback)', price: 33.0, category: 'books', merchant: 'PageTurn', tags: ['book', 'programming', 'software'] },
  { id: 'b-002', title: 'Designing Data-Intensive Applications', price: 48.0, category: 'books', merchant: 'PageTurn', tags: ['book', 'data', 'systems', 'database'] },
  { id: 'b-003', title: 'Clean Code (paperback)', price: 29.0, category: 'books', merchant: 'PageTurn', tags: ['book', 'code', 'software'] },
  { id: 'h-001', title: 'Cast-iron Skillet 26cm', price: 27.5, category: 'home', merchant: 'HearthCo', tags: ['skillet', 'pan', 'kitchen', 'cast-iron'] },
  { id: 'h-002', title: 'Insulated Water Bottle 750ml', price: 16.0, category: 'home', merchant: 'HearthCo', tags: ['bottle', 'water', 'insulated'] },
  { id: 'h-003', title: 'Memory-foam Pillow', price: 36.0, category: 'home', merchant: 'RestWell', tags: ['pillow', 'sleep'] },
  { id: 'g-001', title: 'Game Console Bundle (disc edition)', price: 449.0, category: 'gaming', merchant: 'PlayHub', tags: ['console', 'game', 'gaming'] },
  { id: 'g-002', title: 'Gaming Mouse RGB', price: 39.0, category: 'gaming', merchant: 'PlayHub', tags: ['mouse', 'gaming', 'rgb'] },
  { id: 'x-001', title: 'Gift Card, $100 (any store)', price: 100.0, category: 'gift-cards', merchant: 'CardMart', tags: ['gift', 'card'] },
];

const STOP = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'and', 'or', 'with', 'under', 'below', 'less', 'than', 'max', 'up', 'i', 'need', 'want', 'buy', 'get', 'find', 'me', 'my', 'please', 'cheap', 'best', 'good', 'some', 'usd', 'dollars', 'dollar']);

function tokens(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+(\.\d+)?$/.test(w));
}

function search({ query, maxPrice, category }, limit = 5) {
  const q = tokens(query || '');
  const scored = [];
  for (const it of CATALOG) {
    if (category && it.category !== String(category).toLowerCase()) continue;
    if (Number.isFinite(maxPrice) && maxPrice > 0 && it.price > maxPrice) continue;
    const hay = new Set([...tokens(it.title), ...it.tags]);
    let score = 0;
    for (const w of q) {
      if (hay.has(w)) score += 2;
      else for (const h of hay) if (h.length > 3 && (h.startsWith(w) || w.startsWith(h))) { score += 1; break; }
    }
    if (q.length === 0 || score > 0) scored.push({ ...it, score });
  }
  scored.sort((a, b) => b.score - a.score || a.price - b.price);
  return scored.slice(0, limit).map(({ score, ...rest }) => rest);
}

function byId(id) { return CATALOG.find(i => i.id === id) || null; }

module.exports = { CATALOG, search, byId, tokens };
