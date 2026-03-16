const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { createFromSession } = require('../services/futursoftApiClient');

// GET /api/futursoft/purchase-orders/:nr
router.get('/purchase-orders/:nr', auth, async (req, res) => {
  try {
    const client = await createFromSession(req.session);
    const po = await client.getPurchaseOrder(req.params.nr);
    res.json(po);
  } catch (err) {
    res.status(502).json({ error: `Futursoft error: ${err.message}` });
  }
});

// GET /api/futursoft/purchase-orders?supplierNr=...
router.get('/purchase-orders', auth, async (req, res) => {
  try {
    const client = await createFromSession(req.session);
    const pos = await client.getOpenPurchaseOrdersForSupplier(req.query.supplierNr || '');
    res.json(pos);
  } catch (err) {
    res.status(502).json({ error: `Futursoft error: ${err.message}` });
  }
});

// GET /api/futursoft/products?search=...
router.get('/products', auth, async (req, res) => {
  try {
    const client = await createFromSession(req.session);
    const products = await client.searchProducts(req.query.search || '');
    res.json(products);
  } catch (err) {
    res.status(502).json({ error: `Futursoft error: ${err.message}` });
  }
});

// GET /api/futursoft/products/:code
router.get('/products/:code', auth, async (req, res) => {
  try {
    const client = await createFromSession(req.session);
    const product = await client.getProduct(req.params.code);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(502).json({ error: `Futursoft error: ${err.message}` });
  }
});

module.exports = router;
