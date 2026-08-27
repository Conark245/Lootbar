import mongoose from 'mongoose';

// Setup connection listeners once
let listenersInitialized = false;

function setupConnectionListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  mongoose.connection.on('connected', () => {
    console.log('MongoDB connected successfully.');
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error encountered:', err.message || err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected. Mongoose will attempt to reconnect automatically.');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected.');
  });
}

export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("MONGODB_URI is not set. Database features are currently disabled or fallback.");
    return false;
  }

  setupConnectionListeners();
  
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 20,
      minPoolSize: 2,
      retryWrites: true,
      retryReads: true,
    });
    return true;
  } catch (error: any) {
    console.error("MongoDB initial connection error:", error.message || error);
    return false;
  }
}

