/** Lists active LiveKit rooms and what each participant is publishing. */
import 'dotenv/config';
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';

const svc = new RoomServiceClient((process.env.LIVEKIT_URL ?? '').replace(/^wss:/, 'https:'), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const rooms = await svc.listRooms();
if (!rooms.length) console.log('No active rooms.');
for (const r of rooms) {
  for (const p of await svc.listParticipants(r.name)) {
    const tracks = p.tracks.map((t) => `${TrackSource[t.source] ?? t.source}${t.muted ? ' (muted)' : ''}`).join(', ');
    console.log(`${r.name}: ${p.name} → ${tracks || 'no tracks'}`);
  }
}
