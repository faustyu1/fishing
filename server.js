import express from 'express';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.server' });

const { default: spotifyHandler } = await import('./api/spotify.js');
const { default: viewsHandler } = await import('./api/views.js');
const { default: wakatimeHandler } = await import('./api/wakatime.js');

const PORT = 4000;

for (const key of ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN']) {
  if (!process.env[key]) {
    console.error(`❌ ${key} is not set in .env.server (see SERVER.md)`);
    process.exit(1);
  }
}

const app = express();

app.get('/api/spotify', spotifyHandler);
app.all('/api/views', express.json(), viewsHandler);
app.get('/api/wakatime', wakatimeHandler);

app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});
