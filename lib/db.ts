import mongoose from "mongoose";

declare global {
  var _mongooseConn: typeof mongoose | null;
  var _mongoosePromise: Promise<typeof mongoose> | null;
}

const MONGODB_URI = process.env.MONGODB_URI as string;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined in environment variables");
}

let cached = global._mongooseConn;
let cachedPromise = global._mongoosePromise;

export async function connectDB(): Promise<typeof mongoose> {
  if (cached) return cached;

  if (!cachedPromise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    cachedPromise = mongoose.connect(MONGODB_URI, opts).then((m) => {
      global._mongooseConn = m;
      return m;
    });
  }

  try {
    cached = await cachedPromise;
  } catch (e) {
    cachedPromise = null;
    throw e;
  }

  return cached;
}

export async function disconnectDB(): Promise<void> {
  if (cached) {
    await mongoose.disconnect();
    cached = null;
    cachedPromise = null;
    global._mongooseConn = null;
    global._mongoosePromise = null;
  }
}

/** Helper: run an operation inside a Mongo transaction if replica set is available */
export async function withTransaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  if (process.env.MONGO_NO_TRANSACTIONS === "true") {
    // Simulated session (no real transaction) — dev / single-node mode
    const fakeSession = {} as mongoose.ClientSession;
    return fn(fakeSession);
  }

  await connectDB();
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
