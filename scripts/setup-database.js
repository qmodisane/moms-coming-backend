const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setupDatabase() {
  // First connect to postgres database to create our game database
  const adminClient = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres'
  });

  try {
    await adminClient.connect();
    console.log('Connected to PostgreSQL');

    // Check if database exists
    const dbCheck = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [process.env.DB_NAME]
    );

    if (dbCheck.rows.length === 0) {
      console.log(`Creating database: ${process.env.DB_NAME}`);
      await adminClient.query(`CREATE DATABASE ${process.env.DB_NAME}`);
      console.log('✓ Database created');
    } else {
      console.log('Database already exists');
    }

    await adminClient.end();

    // Now connect to our game database and run schema
    const gameClient = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    await gameClient.connect();
    console.log(`Connected to ${process.env.DB_NAME}`);

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'database-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('Running database schema...');
    await gameClient.query(schema);
    console.log('✓ Schema created successfully');

    await gameClient.end();
    console.log('\n✅ Database setup complete!');
    console.log('\nYou can now run: npm run dev');

  } catch (error) {
    console.error('❌ Database setup error:', error.message);
    process.exit(1);
  }
}

setupDatabase();
