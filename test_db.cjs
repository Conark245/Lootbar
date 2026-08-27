const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  const AppConfig = mongoose.model('SavedGame', new mongoose.Schema({}, { strict: false }));
  const game = await AppConfig.findOne({ gameId: '5791' }); // Magic chess is usually 5791, but let's just find one
  if (game) {
    console.log(JSON.stringify(game.get('lastKnownSkus').slice(0, 2), null, 2));
  } else {
     const anyGame = await AppConfig.findOne({ lastKnownSkus: { $exists: true, $not: {$size: 0} } });
     console.log(JSON.stringify(anyGame.get('lastKnownSkus').slice(0, 2), null, 2));
  }
  process.exit(0);
}
run();
