const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  const SavedGame = mongoose.model('SavedGame', new mongoose.Schema({}, { collection: 'savedgames', strict: false }));
  const games = await SavedGame.find({ name: /Magic/i });
  console.log("Found:", games.length);
  if (games.length > 0) {
    console.log(JSON.stringify(games[0], null, 2));
  }
  process.exit(0);
}
run();
