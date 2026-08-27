const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  const AppConfig = mongoose.model('FzrCardsProduct', new mongoose.Schema({}, { strict: false }));
  const games = await AppConfig.find({ name: /Magic/i });
  console.log("Found in FZR:", games.length);
  if (games.length > 0) {
    console.log(JSON.stringify(games[0].get('skus').slice(0, 2), null, 2));
  }
  process.exit(0);
}
run();
