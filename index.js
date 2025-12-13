import express from "express";
import QRCode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

const app = express();
const PORT = process.env.PORT || 3000;

let qrCode = null;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    if (update.qr) {
      qrCode = await QRCode.toDataURL(update.qr);
      console.log("📲 QR Code gerado");
    }

    if (update.connection === "open") {
      console.log("✅ WhatsApp conectado");
      qrCode = null;
    }
  });
}

startWhatsApp();

app.get("/qr", (req, res) => {
  if (!qrCode) {
    return res.json({ connected: true });
  }
  res.json({ qr: qrCode });
});

app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta", PORT);
});
