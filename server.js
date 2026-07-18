const express = require('express');
const cors = require('cors');
const coursHandler = require('./cours');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API route
app.get('/api/cours', async (req, res) => {
  await coursHandler(req, res);
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'BRVM Live API',
    endpoints: {
      '/api/cours': 'Get all stocks (JSON)',
      '/api/cours?symbole=ONTBF': 'Get single stock by symbol',
      '/api/cours?format=csv': 'Get all stocks in CSV format'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`BRVM Live API running on port ${PORT}`);
  console.log(`Access at http://localhost:${PORT}`);
});
