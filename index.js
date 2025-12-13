import express from "express";
import QRCode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Guarda sessões ativas
const sessions = {};

async function createSession(clientId) {
  if (sessions[clientId]) return sessions[clientId];

  const { state, saveCreds } = await useMultiFileAuthState(
    `auth/${clientId}`
  );

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sessions[clientId] = {
    sock,
    qr: null,
    connected: false
  };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    if (update.qr) {
      sessions[clientId].qr = await QRCode.toDataURL(update.qr);
    }

    if (update.connection === "open") {
      sessions[clientId].connected = true;
      sessions[clientId].qr = null;
      console.log(`✅ Cliente ${clientId} conectado`);
    }

    if (update.connection === "close") {
      sessions[clientId].connected = false;
      console.log(`❌ Cliente ${clientId} desconectado`);
    }
  });

  return sessions[clientId];
}

/* ---------- ROTAS ---------- */

// Inicia sessão
app.get("/connect/:clientId", async (req, res) => {
  const { clientId } = req.params;
  await createSession(clientId);
  res.json({ started: true });
});

// Retorna QR
app.get("/qr/:clientId", async (req, res) => {
  const { clientId } = req.params;
  const session = sessions[clientId];

  if (!session) {
    return res.status(404).json({ error: "Sessão não iniciada" });
  }

  if (session.connected) {
    return res.json({ connected: true });
  }

  res.json({ qr: session.qr });
});

// Status
app.get("/status/:clientId", (req, res) => {
  const session = sessions[req.params.clientId];
  res.json({
    connected: session?.connected || false
  });
});

// Enviar mensagem
app.post("/send/:clientId", async (req, res) => {
  const { clientId } = req.params;
  const { number, message } = req.body;

  const session = sessions[clientId];
  if (!session || !session.connected) {
    return res.status(400).json({ error: "WhatsApp não conectado" });
  }

  const jid = number.replace(/\D/g, "") + "@s.whatsapp.net";
  await session.sock.sendMessage(jid, { text: message });

  res.json({ sent: true });
});

app.listen(PORT, () => {
  console.log("🚀 Multi-WhatsApp Server rodando na porta", PORT);
});
