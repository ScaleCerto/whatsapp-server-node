async function getSession(clientId) {
  if (sessions[clientId]) return sessions[clientId];

  if (!fs.existsSync("auth")) fs.mkdirSync("auth");

  const { state, saveCreds } = await useMultiFileAuthState(`auth/${clientId}`);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000
  });

  sessions[clientId] = { sock, qr: null, connected: false };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      sessions[clientId].qr = await QRCode.toDataURL(qr);
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
      const reason = lastDisconnect?.error?.output?.statusCode;

      console.log(`❌ ${clientId} desconectado`, reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log(`🚫 ${clientId} deslogado`);
        delete sessions[clientId];
      } else {
        console.log(`🔄 Reconectando ${clientId} em 5s`);
        setTimeout(() => getSession(clientId), 5000);
      }
    }
  });

  return sessions[clientId];
}
