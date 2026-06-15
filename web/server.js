require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Simple in-memory rate limiter: max 3 submissions per IP per minute
const recentSubmissions = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60_000;
  const max = 3;

  const times = (recentSubmissions.get(ip) || []).filter(t => now - t < windowMs);
  if (times.length >= max) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }
  times.push(now);
  recentSubmissions.set(ip, times);
  next();
}

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

app.post('/api/waitlist', rateLimit, async (req, res) => {
  const { email } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const timestamp = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'Waitlist!A:C',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[clean, timestamp, req.headers['user-agent'] || '']],
      },
    });

    console.log(`[waitlist] Added: ${clean}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[waitlist] Sheets error:', err.message);
    res.status(500).json({ error: 'Failed to save. Please try again.' });
  }
});

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tempo waitlist running → http://localhost:${PORT}`);
});
