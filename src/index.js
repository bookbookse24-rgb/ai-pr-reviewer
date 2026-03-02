require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { handleWebhook } = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ai-pr-reviewer' }));
app.post('/webhook', handleWebhook);

app.listen(PORT, '0.0.0.0', () => console.log(`🤖 AI PR Reviewer running on port ${PORT}`));
