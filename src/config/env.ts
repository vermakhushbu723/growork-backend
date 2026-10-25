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
  /** Where uploaded resumes, documents and photos are stored on disk. */
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  /** LiveKit (voice / video calls). Calls are disabled until all three are set. */
  livekitUrl: process.env.LIVEKIT_URL ?? '',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? '',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
  /**
   * Firebase service account for push notifications: a path to the JSON key
   * file, or the JSON itself. Push is disabled while it's empty.
   */
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT ?? '',
  /** Razorpay (adding money to the wallet). Payments are off until both keys are set. */
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
  /** Dashboard → Webhooks secret; lets payments finish even if the app closes mid-payment. */
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  /**
   * Credit the wallet without a payment (`POST /wallet/add-money`). Only for
   * local testing; never in production, where Razorpay must confirm payment.
   */
  allowDirectTopup:
    (process.env.ALLOW_DIRECT_TOPUP ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
};
