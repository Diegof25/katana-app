const { Pool } = require('pg');
require('dotenv').config();

// Usamos connectionString que es lo que pide Neon y Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Esto es obligatorio para conectar con Neon
  }
});

module.exports = pool;