import express from "express";
import QRCode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessions = {};

async function createSession(clientId) {
  if (sessions[clientId]) {
    return sessions[clientId];
  }

  const { state, saveCreds } = await useMultiFileAuthState(
    `auth/${clientId}`
  );

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["SaaS", "Chrome", "1.0"]
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

      // Se NÃO for logout, remove sessão para gerar novo QR
      if (reason !== DisconnectReason.loggedOut) {
        delete sessions[clientId];
      }
    }
  });

  return sessions[clientId];
}

/* ---------- ROTAS ---------- */

// QR = ponto central do SaaS
app.get("/qr/:clientId", async (req, res) => {
  const session = await createSession(req.params.clientId);

  if (session.connected) {
    return res.json({ connected: true });
  }

  if (!session.qr) {
    return res.json({ status: "waiting_qr" });
  }

  res.json({ qr: session.qr });
});

// Status
app.get("/status/:clientId", (req, res) => {
  res.json({
    connected: sessions[req.params.clientId]?.connected || false
  });
});

// Enviar mensagem
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
app.listen(PORT, () => {
  console.log("🚀 Multi-WhatsApp SaaS v2 ATIVO", PORT);
});
