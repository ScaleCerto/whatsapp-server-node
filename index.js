import express from "express";
import QRCode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import fs from "fs";

const app = express();
app.use(express.json());

/* ==============================
   DESATIVAR CACHE (ESSENCIAL P/ QR)
================================ */
app.use((req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

const PORT = process.env.PORT || 3000;
const sessions = {};

/* ==============================
   CRIA / GARANTE SESSÃO
================================ */
async function getSession(clientId) {
  if (sessions[clientId]) {
    return sessions[clientId];
  }

  if (!fs.existsSync("auth")) {
    fs.mkdirSync("auth");
  }

  const { state, saveCreds } = await useMultiFileAuthState(
    `auth/${clientId}`
  );

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,

    browser: ["Chrome", "Linux", "1.0"],
    mobile: false,

    syncFullHistory: false,
    retryRequestDelayMs: 250,

    getMessage: async () => {
      return undefined;
    },

    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,

    emitOwnEvents: true,
    markOnlineOnConnect: false
  });

  sessions[clientId] = {
    sock,
    qr: null,
    connected: false
  };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      sessions[clientId].qr = await QRCode.toDataURL(qr);
      console.log(`📲 QR gerado para ${clientId}`);
    }

    if (connection === "open") {
      sessions[clientId].connected = true;
      sessions[clientId].qr = null;
      console.log(`✅ ${clientId} conectado`);
    }

    if (connection === "close") {
      sessions[clientId].connected = false;

      const reason =
        lastDisconnect?.error?.output?.statusCode;

      console.log(`❌ ${clientId} desconectado`, reason);

      if (reason !== DisconnectReason.loggedOut) {
        delete sessions[clientId];
      }
    }
  });

  return sessions[clientId];
}

/* ==============================
   ROTAS
================================ */

app.get("/qr/:clientId", async (req, res) => {
  const session = await getSession(req.params.clientId);

  if (session.connected) {
    return res.json({ connected: true });
  }

  if (!session.qr) {
    return res.json({ status: "waiting_qr" });
  }

  res.json({ qr: session.qr });
});

app.get("/status/:clientId", (req, res) => {
  res.json({
    connected: sessions[req.params.clientId]?.connected || false
  });
});

app.post("/send/:clientId", async (req, res) => {
  const { clientId } = req.params;
  const { number, message } = req.body;

  const session = sessions[clientId];
  if (!session || !session.connected) {
    return res.status(400).json({
      error: "WhatsApp não conectado"
    });
  }

  const jid = number.replace(/\D/g, "") + "@s.whatsapp.net";
  await session.sock.sendMessage(jid, { text: message });

  res.json({ sent: true });
});

/* ==============================
   START
================================ */
app.listen(PORT, () => {
  console.log("🚀 Multi-WhatsApp SaaS FINAL rodando na porta", PORT);
});
