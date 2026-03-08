/**
 * eBoekhouden proxy routes
 * Proxyt API calls naar api.e-boekhouden.nl zodat requests vanuit een
 * vaste Railway IP komen (Vercel datacenter IPs worden geblokkeerd door eBoekhouden).
 */
const express = require('express');
const router = express.Router();

const BASE_URL = 'https://api.e-boekhouden.nl/v1';
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${BASE_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken: process.env.EBOEKHOUDEN_API_KEY,
      source: 'Dashboard',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBoekhouden auth fout ${res.status}: ${text}`);
  }

  const data = await res.json();
  cachedToken = data.token;
  tokenExpiry = Date.now() + (data.expiresIn - 60) * 1000; // 1 min marge
  return cachedToken;
}

async function proxyGet(path, queryString) {
  let token;
  try {
    token = await getToken();
  } catch (err) {
    throw err;
  }

  const url = `${BASE_URL}${path}${queryString ? '?' + queryString : ''}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  // Token verlopen → reset en retry
  if (res.status === 401) {
    cachedToken = null;
    tokenExpiry = 0;
    return proxyGet(path, queryString);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBoekhouden API fout ${res.status}: ${text}`);
  }

  return res.json();
}

// Proxy alle GET requests: /api/eboekhouden/:path*
router.get('/*', async (req, res) => {
  try {
    const path = '/' + req.params[0];
    const queryString = new URLSearchParams(req.query).toString();
    const data = await proxyGet(path, queryString);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy PUT requests: /api/eboekhouden/:path*
router.put('/*', async (req, res) => {
  try {
    let token = await getToken();
    const path = '/' + req.params[0];
    const url = `${BASE_URL}${path}`;

    let response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    // Token verlopen → reset en retry
    if (response.status === 401) {
      cachedToken = null; tokenExpiry = 0;
      token = await getToken();
      response = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
    }

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `eBoekhouden fout ${response.status}: ${text}` });
    }

    const text = await response.text();
    res.json(text ? JSON.parse(text) : { ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
