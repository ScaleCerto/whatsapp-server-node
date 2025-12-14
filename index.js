import express from "express";
import QRCode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import fs from "fs";
import http from "http";
import { Server } from "socket.io"; // ✅ Certifique-se de instalar: yarn add socket.io ou npm install socket.io

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// ==============================
// DESATIVAR CACHE
// ==============================
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

const PORT = process.env.PORT || 3000;
const sessions = {};

// ==============================
// FUNÇÃO DE SESSÃO
// ==============================
async function getSession(clientId) {
  if (sessions[clientId]) return sessions[clientId];

  if (!fs.existsSync("auth")) fs.mkdirSync("auth");

  const { state, saveCreds } = await useMultiFileAuthState(`auth/${clientId}`);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ["Chrome", "Linux", "1.0"],
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    emitOwnEvents: true,
    markOnlineOnConnect: false
  });

  sessions[clientId] = { sock, qr: null, connected: false };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      sessions[clientId].qr = await QRCode.toDataURL(qr);
      console.log(`📲 QR gerado para ${clientId}`);
      io.to(clientId).emit("qr", sessions[clientId].qr);
    }

    if (connection === "open") {
      sessions[clientId].connected = true;
      sessions[clientId].qr = null;
      console.log(`✅ ${clientId} conectado`);
      io.to(clientId).emit("connected", true);
    }

    if (connection === "close") {
      sessions[clientId].connected = false;
      const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.reason;
      console.log(`❌ ${clientId} desconectado`, reason);

      if (reason === DisconnectReason.loggedOut) {
        if (fs.existsSync(`auth/${clientId}`)) fs.rmSync(`auth/${clientId}`, { recursive: true, force: true });
        delete sessions[clientId];
      } else {
        console.log(`🔄 Tentando reconectar ${clientId} em 5s...`);
        setTimeout(() => getSession(clientId), 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", async (msg) => {
    // aqui você pode processar mensagens recebidas
  });

  return sessions[clientId];
}

// ==============================
// ROTAS
// ==============================

app.get("/qr/:clientId", async (req, res) => {
  try {
    const session = await getSession(req.params.clientId);
    if (session.connected) return res.json({ connected: true });
    if (!session.qr) return res.json({ status: "waiting_qr" });
    res.json({ qr: session.qr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/qr-image/:clientId", async (req, res) => {
  try {
    const session = await getSession(req.params.clientId);
    if (session.connected) return res.send("✅ WhatsApp já conectado");
    if (!session.qr) return res.send("⏳ QR ainda não gerado, atualize a página");

    const base64Data = session.qr.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/status/:clientId", (req, res) => {
  res.json({ connected: sessions[req.params.clientId]?.connected || false });
});

app.post("/send/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { number, message } = req.body;

    const session = sessions[clientId];
    if (!session || !session.connected)
      return res.status(400).json({ error: "WhatsApp não conectado" });

    const jid = number.replace(/\D/g, "") + "@s.whatsapp.net";
    await session.sock.sendMessage(jid, { text: message });

    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/qr-view/:clientId", async (req, res) => {
  try {
    const session = await getSession(req.params.clientId);

    if (session.connected) return res.send("✅ WhatsApp já conectado");
    if (!session.qr) return res.send("⏳ QR ainda não gerado, atualize a página");

    res.send(`
      <html>
        <head>
          <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
          <meta http-equiv="Pragma" content="no-cache" />
          <meta http-equiv="Expires" content="0" />
          <title>Escaneie o QR do WhatsApp</title>
        </head>
        <body style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;">
          <h2>Escaneie este QR com seu WhatsApp</h2>
          <img id="qrCode" src="${session.qr}" style="width:300px; height:300px;" />
          <p>Se o QR expirar, atualize a página para gerar um novo.</p>
          <script src="/socket.io/socket.io.js"></script>
          <script>
            const socket = io();
            socket.emit('join', '${req.params.clientId}');
            socket.on('qr', (qrData) => {
              document.getElementById('qrCode').src = qrData;
            });
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==============================
// WEBSOCKET
// ==============================
io.on("connection", (socket) => {
  console.log("Novo cliente conectado");

  socket.on('join', (clientId) => {
    socket.join(clientId);
    console.log(`Cliente ${clientId} conectado ao WebSocket`);

    const session = sessions[clientId];
    if (session?.qr) {
      socket.emit("qr", session.qr);
    }
  });
});

// ==============================
// INICIAR SERVIDOR
// ==============================
server.listen(PORT, () => {
  console.log("🚀 Multi-WhatsApp SaaS rodando na porta", PORT);
});
