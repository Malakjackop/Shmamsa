// server.js
require("dotenv").config();
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const app = express();
app.use(express.json());

// ================================
// 🔐 SECURITY: API KEY MIDDLEWARE
// ================================
app.use((req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== process.env.SECRET_KEY) {
    console.log("🚫 Unauthorized request blocked!");
    return res.status(403).json({ error: "Unauthorized" });
  }

  next();
});

// ================================
// 🔹 Initialize WhatsApp Client
// ================================
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "shmamsa-session" }),
});

client.on("qr", (qr) => {
  console.log("📱 Scan this QR code using WhatsApp:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  client._isReady = true;
  console.log("✅ WhatsApp client is ready to send messages!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Authentication failed:", msg);
});

client.on("disconnected", (reason) => {
  console.warn("⚠️ WhatsApp client disconnected:", reason);
});

client.initialize();

// ================================
// 🔹 Helper Functions
// ================================
function toIntlEgyptian(localNumber) {
  if (!localNumber) return "";
  const cleaned = localNumber.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    return "20" + cleaned.slice(1);
  }
  return cleaned;
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Temporary store for OTPs
const otpsForgot = new Map();

// ================================
// 🔹 Send OTP for Forgot Password
// ================================
app.post("/forgot-password", async (req, res) => {
  try {
    if (!client._isReady) {
      return res
        .status(503)
        .json({ success: false, message: "WhatsApp client not ready. Scan QR first." });
    }

    let { targetPhone, username } = req.body;
    if (!targetPhone)
      return res.status(400).json({ success: false, message: "targetPhone is required" });

    const intl = toIntlEgyptian(targetPhone);
    console.log("📩 Forgot password:", username || "Unknown user", "→", intl);

    const numberId = await client.getNumberId(intl);
    if (!numberId) {
      console.warn("🚫 Phone number not registered:", intl);
      return res.status(400).json({ success: false, message: "Phone number not found on WhatsApp" });
    }

    const code = generateOTP();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    otpsForgot.set(intl, { code, expiresAt });

    const chatId = `${intl}@c.us`;

    const message =
      `👋 Hello ${username || "User"}!\n\n` +
      `Your password reset code is: *${code}*\n` +
      `It is valid for 5 minutes.\n\n` +
      `— Shmamsa Security Team`;

    console.log("📤 Sending OTP to:", chatId);
    await client.sendMessage(chatId, message);

    return res.json({ success: true, message: "OTP sent via WhatsApp", to: intl });
  } catch (err) {
    console.error("❌ /forgot-password error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ================================
// 🔹 Verify OTP
// ================================
app.post("/verify-otp", (req, res) => {
  try {
    const { targetPhone, code } = req.body;

    if (!targetPhone || !code)
      return res
        .status(400)
        .json({ success: false, message: "targetPhone and code are required" });

    const intl = toIntlEgyptian(targetPhone);
    const entry = otpsForgot.get(intl);

    if (!entry)
      return res.status(400).json({ success: false, message: "No OTP found or expired" });

    if (Date.now() > entry.expiresAt) {
      otpsForgot.delete(intl);
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    if (entry.code !== code)
      return res.status(400).json({ success: false, message: "Invalid OTP" });

    otpsForgot.delete(intl);
    return res.json({
      success: true,
      message: "✅ OTP verified! You may now reset your password.",
    });
  } catch (err) {
    console.error("❌ /verify-otp error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ================================
// 🔹 Generic Send Message
// ================================
app.post("/send-message", async (req, res) => {
  try {
    if (!client._isReady) {
      return res.status(503).json({ success: false, message: "WhatsApp client not ready." });
    }

    const { phone, message, username } = req.body;
    if (!phone || !message)
      return res.status(400).json({ success: false, message: "phone and message required" });

    const intl = toIntlEgyptian(phone);
    const chatId = `${intl}@c.us`;

    const personalized =
      username ? `Hi ${username} 👋\n\n${message}\n\n— Shmamsa Team` : message;

    await client.sendMessage(chatId, personalized);

    return res.json({ success: true, message: "Message sent successfully", to: intl });
  } catch (err) {
    console.error("❌ /send-message error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ================================
// 🔹 Start Server
// ================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Node WhatsApp API running on port ${PORT}`));
