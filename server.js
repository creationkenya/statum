require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const STATUM_API_URL = process.env.STATUM_API_URL || 'https://api.statum.co.ke/api/v2/stk-push';
const CONSUMER_KEY = process.env.STATUM_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.STATUM_CONSUMER_SECRET;
const PAYBILL_ACCOUNT = process.env.STATUM_PAYBILL_ACCOUNT_CODE;

// Utility delay function (8000ms = 8 seconds)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isProcessing = false;
const queue = [];

async function processQueue() {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;
  const task = queue.shift();

  try {
    const authHeader = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

    const params = {
      phone_number: task.phoneNumber,
      amount: task.amount,
      account_reference: PAYBILL_ACCOUNT || task.accountReference,
      transaction_desc: task.description || 'Statum Wallet Top-Up',
    };

    console.log(`[${new Date().toISOString()}] Sending GET STK Push to ${task.phoneNumber} for KES ${task.amount}...`);

    // Changed from axios.post to axios.get with query parameters
    const response = await axios.get(STATUM_API_URL, {
      params,
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Accept': 'application/json',
      },
    });

    console.log(`[SUCCESS] Response:`, response.data);
    task.resolve({ status: 'success', data: response.data });
  } catch (error) {
    console.error(`[ERROR] STK Push failed:`, error.response?.data || error.message);
    task.reject(error.response?.data || { message: error.message });
  } finally {
    console.log(`Waiting 8 seconds before processing the next request...`);
    await sleep(8000);
    isProcessing = false;
    processQueue();
  }
}

// Health check endpoint for UptimeRobot / Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', queueLength: queue.length, isProcessing });
});

// Single STK Push endpoint
app.post('/stk-push', (req, res) => {
  const { phoneNumber, amount, accountReference, description } = req.body;

  if (!phoneNumber || !amount) {
    return res.status(400).json({ error: 'phoneNumber and amount are required' });
  }

  new Promise((resolve, reject) => {
    queue.push({ phoneNumber, amount, accountReference, description, resolve, reject });
    processQueue();
  })
    .then((result) => res.status(200).json(result))
    .catch((err) => res.status(500).json({ error: err }));
});

// Batch STK Push endpoint with 8-second pacing
app.post('/batch-stk-push', (req, res) => {
  const { requests } = req.body;

  if (!Array.isArray(requests) || requests.length === 0) {
    return res.status(400).json({ error: 'requests must be a non-empty array' });
  }

  requests.forEach((reqItem) => {
    queue.push({
      phoneNumber: reqItem.phoneNumber,
      amount: reqItem.amount,
      accountReference: reqItem.accountReference,
      description: reqItem.description,
      resolve: () => {},
      reject: () => {},
    });
  });

  processQueue();

  res.status(202).json({
    message: `Enqueued ${requests.length} STK push requests. Processing sequentially with 8-second intervals.`,
    queueLength: queue.length,
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
