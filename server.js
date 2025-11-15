// server.js
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

// 🔹 Initialize WhatsApp client and store session locally
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'shmamsa-session' }),
});

client.on('qr', (qr) => {
  console.log('📱 Scan this QR code using WhatsApp on your phone (01033644969):');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  client._isReady = true;
  console.log('✅ WhatsApp client is ready to send messages!');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
  console.warn('⚠️ WhatsApp client disconnected:', reason);
});

client.initialize();

// 🔹 Temporary in-memory database (for testing)
const otpsForgot = new Map(); // key = phoneIntl, value = { code, expiresAt }

// 🔹 Helper functions
function toIntlEgyptian(localNumber) {
  if (!localNumber) return '';
  const cleaned = localNumber.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    return '20' + cleaned.slice(1);
  }
  return cleaned;
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🔹 Send OTP via WhatsApp (Forgot Password)
app.post('/forgot-password', async (req, res) => {
  try {
    if (!client._isReady) {
      return res.status(503).json({ success: false, message: 'WhatsApp client not ready. Scan QR and wait.' });
    }

    let { targetPhone, username } = req.body; // username added
    if (!targetPhone)
      return res.status(400).json({ success: false, message: 'targetPhone is required' });

    const intl = toIntlEgyptian(targetPhone); // e.g. 201207320339
    console.log('📩 Forgot password request for:', username || 'Unknown user', '→', intl);

    // Check if the number exists on WhatsApp
    const numberId = await client.getNumberId(intl);
    if (!numberId) {
      console.warn('🚫 Phone number not registered on WhatsApp:', intl);
      return res.status(400).json({ success: false, message: 'Phone number not registered on WhatsApp' });
    }

    const code = generateOTP();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    otpsForgot.set(intl, { code, expiresAt });

    const chatId = `${intl}@c.us`;

    // Personalized message
    const message = `Hi ${username || 'User'} 👋\n\nHere is your password reset code: ${code}\nIt’s valid for 5 minutes.\n\n— Shmamsa Security Team`;

    console.log('📤 Sending OTP to:', chatId);
    await client.sendMessage(chatId, message);

    return res.json({ success: true, message: 'OTP sent via WhatsApp', to: intl });
  } catch (err) {
    console.error('❌ /forgot-password error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 Verify OTP (Forgot Password)
app.post('/verify-otp', (req, res) => {
  try {
    const { targetPhone, code } = req.body;
    if (!targetPhone || !code)
      return res.status(400).json({ success: false, message: 'targetPhone and code are required' });

    const intl = toIntlEgyptian(targetPhone);
    const entry = otpsForgot.get(intl);

    if (!entry)
      return res.status(400).json({ success: false, message: 'No OTP found or it has expired' });

    if (Date.now() > entry.expiresAt) {
      otpsForgot.delete(intl);
      return res.status(400).json({ success: false, message: 'OTP has expired' });
    }

    if (entry.code !== code)
      return res.status(400).json({ success: false, message: 'Invalid OTP' });

    otpsForgot.delete(intl);
    return res.json({
      success: true,
      message: '✅ OTP verified successfully. You can now reset your password.',
    });
  } catch (err) {
    console.error('❌ /verify-otp error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 Optional: Send a direct WhatsApp message (for testing)
app.post('/send-message', async (req, res) => {
  try {
    if (!client._isReady) {
      return res.status(503).json({ success: false, message: 'WhatsApp client not ready.' });
    }

    const { phone, message, username } = req.body; // username optional
    if (!phone || !message)
      return res.status(400).json({ success: false, message: 'phone and message are required' });

    const intl = toIntlEgyptian(phone);
    const chatId = `${intl}@c.us`;

    // Add username to message if provided
    const personalizedMsg = username
      ? `Hi ${username} 👋\n\n${message}\n\n— Shmamsa Team`
      : message;

    await client.sendMessage(chatId, personalizedMsg);
    return res.json({ success: true, message: 'Message sent successfully', to: intl });
  } catch (err) {
    console.error('❌ /send-message error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
