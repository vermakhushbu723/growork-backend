import 'dotenv/config';

const required = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing environment variable ${key}`);
  return v;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5080),
  mongoUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  // Dev mode returns the OTP in the API response (never enable in production).
  otpDevMode: (process.env.OTP_DEV_MODE ?? 'true') === 'true',
  // Platform fee taken from freelancer payouts, and marketplace fee added for clients.
  freelancerFeeRate: 0.1,
  clientFeeRate: 0.03,
};
