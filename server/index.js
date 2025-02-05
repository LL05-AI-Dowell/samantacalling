import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(cors());
app.use(express.json());
app.use(cookieParser())

let manager = null;
let client = null;
let clients = [];

// Helper function to safely send messages
const safeSend = (ws, message) => {
  try {
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

// Helper to check connection status
const isConnectionAlive = (ws) => {
  return ws && ws.readyState === ws.OPEN;
};

wss.on("connection", (ws) => {
  console.log("New client connected");

  // Ping-pong to detect stale connections
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on("message", async (event) => {
    try {
      const message = JSON.parse(event);

      switch (message.type) {
        case "connection:admin":
          if (!manager) {
            manager = ws;
            console.log("Admin connected");
          }
          break;

        case "connection:client":
          if (!client) {
            client = ws;
            safeSend(client, { type: 'call:ready' });
            console.log("Primary client connected");
          } else {
            clients.push(ws);
            console.log("Additional client connected");
          }
          break;

        case "offer":
          if (isConnectionAlive(manager)) {
            safeSend(manager, message);
          }
          break;

        case "answer":
          if (isConnectionAlive(client)) {
            safeSend(client, message);
          }
          break;

        case "candidate":
          if (ws === client && isConnectionAlive(manager)) {
            safeSend(manager, message);
          } else if (ws === manager && isConnectionAlive(client)) {
            safeSend(client, message);
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
    console.log("Client disconnected");
    
    if (ws === manager) {
      manager = null;
      safeSend(client, { type: "disconnect" });
    }

    if (ws === client) {
      client = null;
      safeSend(manager, { type: 'disconnect' });
    }

    // Clean up disconnected clients
    clients = clients.filter(c => c !== ws && c.readyState === c.OPEN);
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