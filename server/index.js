import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import dotenv from 'dotenv';
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import User from "./model/User.js";
import connectDB from "./service/db.js";
import imagekit from "./service/imagekit.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(cors());
app.use(express.json());
app.use(cookieParser())

const clients = new Map();
let activeConnections = new Map();

connectDB()

const safeSend = (ws, message) => {
  try {
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

app.post('/login', async (req, res) => {
  try {
    let { username, password } = req.body;

    if(!username || !password) {
      return res.status(400).json({
        message: "Username and Password is required."
      })
    }

    let user = await User.findOne({ username });

    if (user) {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const accessToken = jwt.sign(
        { userId: user._id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      
      return res.json({
        userId: user.clientId,
        username,
        accessToken,
        qrCodeUrl: user.qrCodeUrl
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const clientId = uuidv4();
    const connectionId = uuidv4();
    const callUrl = `${process.env.FRONTEND_URL}/call/${connectionId}/${clientId}`;
    const qrCodeDataUrl = await QRCode.toDataURL(callUrl);

    const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const uploadResponse = await imagekit.upload({
      file: buffer,
      fileName: `qr_${username}.png`
    });

    user = new User({
      username,
      password: hashedPassword,
      clientId,
      qrCodeUrl: uploadResponse.url,
    });

    await user.save();

    const accessToken = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      username,
      accessToken,
      qrCodeUrl: uploadResponse.url,
      userId: clientId,
      callUrl
    });

  } catch (error) {
    console.error("Error in login:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


wss.on("connection", (ws) => {
  console.log("New client connected");

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on("message", async (event) => {
    try {
      const message = JSON.parse(event);
      console.log(message.type);
      
      switch (message.type) {
        case "connection:admin":
          const { clientId } = message;
          console.log(clientId);
          
          const clientExist = clients.get(clientId);
          console.log(clientExist);
          
          if(!clientExist) {
            clients.set(String(clientId), ws);

          }
          break;

        case "connection:client":
          const { targetClientId, connectionId } = message;
          const targetClient = clients.get(String(targetClientId));

          if (targetClient) {
            activeConnections.set(connectionId, {
              clientId: targetClientId,
              userWs: ws
            });
            
            safeSend(targetClient, {
              type: 'call:incoming',
              connectionId
            });
            
            safeSend(ws, { type: 'call:waiting' });
          } else {
            safeSend(ws, { 
              type: 'error',
              message: 'Client not available'
            });
          }
          break;
        case "call:accepted":
        case "call:terminated":
        case "offer":
        case "answer":
        case "candidate":
          
          const connection = activeConnections.get(message.connectionId);
          
          if (connection) {
            const { clientId, userWs } = connection;
            const targetWs = ws === userWs ? clients.get(clientId) : userWs;
            safeSend(targetWs, message);
          }
          break;
        default:
          console.log("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on("close", () => {
    for (const [clientId, clientWs] of clients.entries()) {
      if (clientWs === ws) {
        clients.delete(clientId);
        break;
      }
    }
    for (const [connectionId, conn] of activeConnections.entries()) {
      if (conn.userWs === ws || clients.get(conn.clientId) === ws) {
        activeConnections.delete(connectionId);
      }
    }
    
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Implement connection cleanup interval
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});