/** Verifies the LiveKit keys in .env: creates, lists and deletes a test room. */
import 'dotenv/config';
import { RoomServiceClient } from 'livekit-server-sdk';

const url = (process.env.LIVEKIT_URL ?? '').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
const svc = new RoomServiceClient(url, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const name = `key-check-${Date.now()}`;
await svc.createRoom({ name, emptyTimeout: 30 });
const rooms = await svc.listRooms([name]);
await svc.deleteRoom(name);
console.log(rooms.length === 1 ? `LiveKit OK (${url})` : 'LiveKit: room not found');
