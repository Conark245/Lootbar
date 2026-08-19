import mongoose from 'mongoose';

export async function connectDB() {
  if (mongoose.connection.readyState >= 1) {
    return true;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("MONGODB_URI is not set. Database features are currently disabled or fallback.");
    return false;
  }
  
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log("Connected to MongoDB successfully!");
    return true;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    return false;
  }
}
