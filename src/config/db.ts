import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  // Some local/ISP resolvers refuse SRV lookups needed by mongodb+srv:// URIs.
  // Use public resolvers for those lookups (override with DNS_SERVERS=… in .env).
  if (env.mongoUri.startsWith('mongodb+srv://')) {
    dns.setServers((process.env.DNS_SERVERS ?? '8.8.8.8,1.1.1.1').split(',').map((s) => s.trim()));
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
