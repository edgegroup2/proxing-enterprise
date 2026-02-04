const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // must be before routes

// Routes
const smsRoutes = require('./routes/sms');
app.use('/api', smsRoutes);

// Health
app.get('/', (req, res) => {
  res.send('ProxiNG API running');
});

// Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 ProxiNG server running on port ${PORT}`);
});
