const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  const AppConfig = mongoose.model('SavedGame', new mongoose.Schema({}, { strict: false }));
  const game = await AppConfig.findOne({ name: /Magic Chess/i });
  if (game) {
    console.log("Game ID:", game.get('gameId'));
    console.log(JSON.stringify(game.get('lastKnownSkus').slice(0, 2), null, 2));
  } else {
    console.log("Not found in SavedGame");
  }
  process.exit(0);
}
run();
