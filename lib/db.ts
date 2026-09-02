import mongoose from "mongoose";

declare global {
  // `var` est la seule forme acceptée pour augmenter globalThis : `let` et
  // `const` ne s'y attachent pas. La règle no-var ne s'applique donc pas ici.
  // eslint-disable-next-line no-var
  var _mongooseConn: typeof mongoose | null;
  // eslint-disable-next-line no-var
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

/**
 * Exécute une opération dans une transaction Mongo.
 *
 * En mode `MONGO_NO_TRANSACTIONS=true` (développement sans replica set), la
 * session vaut `undefined` — et non un objet vide : passer `{}` à
 * `Query.session()` ou à `Model.create(..., { session })` fait échouer le
 * pilote. Les appelants doivent donc traiter la session comme optionnelle,
 * ce que le type impose désormais.
 *
 * ⚠ Sans transaction, les écritures liées (facture + écriture comptable) ne
 * sont plus atomiques. À réserver au développement.
 */
export async function withTransaction<T>(
  fn: (session?: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  if (process.env.MONGO_NO_TRANSACTIONS === "true") {
    return fn(undefined);
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
