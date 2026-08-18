import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("MONGODB_URI is not set. Database features are currently mocked or disabled.");
    return false;
  }
  
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB successfully!");
    return true;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    return false;
  }
}
