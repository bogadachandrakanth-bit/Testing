const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// Database Initialization
const dbPath = path.resolve(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to local SQLite database at:', dbPath);
    initializeTables();
  }
});

// Initialize DB tables
function initializeTables() {
  db.serialize(() => {
    // 1. Users Table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        joined TEXT NOT NULL
      )
    `);

    // 2. Login Counts Table
    db.run(`
      CREATE TABLE IF NOT EXISTS login_counts (
        email TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0
      )
    `);

    // 3. Activity Logs Table
    db.run(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        ip TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);
    
    // Seed default admin user if database is empty
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (row && row.count === 0) {
        bcrypt.hash('Password123!', 10, (err, hash) => {
          if (!err) {
            db.run(
              "INSERT INTO users (name, email, password, joined) VALUES (?, ?, ?, ?)",
              ["Nexus Admin", "admin@nexus.io", hash, new Date().toISOString()],
              (err) => {
                if (!err) {
                  console.log("Seeded database with default user 'admin@nexus.io' (password: Password123!)");
                }
              }
            );
          }
        });
      }
    });

    console.log('Database tables verified/initialized.');
  });
}

// ==========================================================================
// Authentication Endpoints
// ==========================================================================

// Register Account
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields (name, email, password) are required.' });
  }

  // Check if user already exists
  db.get("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [email], (err, user) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database check failed.' });
    }
    
    if (user) {
      return res.status(400).json({ error: 'This email is already registered.' });
    }

    // Hash Password
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        return res.status(500).json({ error: 'Password encryption failed.' });
      }

      // Insert User
      const joined = new Date().toISOString();
      db.run(
        "INSERT INTO users (name, email, password, joined) VALUES (?, ?, ?, ?)",
        [name, email, hash, joined],
        function (err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to create user account.' });
          }

          console.log(`Registered user: ${email}`);
          return res.status(201).json({ 
            success: true, 
            message: 'User account registered successfully.' 
          });
        }
      );
    });
  });
});

// Login Authenticate
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  db.get("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email], (err, user) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database authentication query failed.' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    // Check hashed password
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        return res.status(500).json({ error: 'Verification failed.' });
      }

      if (!isMatch) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
      }

      // Increment login count
      db.run(
        `INSERT INTO login_counts (email, count) VALUES (?, 1)
         ON CONFLICT(email) DO UPDATE SET count = count + 1`,
        [user.email],
        (err) => {
          if (err) {
            console.error("Error updating login count:", err);
          }
        }
      );

      // Return user info (omit password)
      return res.status(200).json({
        success: true,
        user: {
          name: user.name,
          email: user.email,
          joined: user.joined
        }
      });
    });
  });
});

// ==========================================================================
// Dashboard / Logging Endpoints
// ==========================================================================

// Get Dashboard Stats (Login count, Activity logs list)
app.get('/api/dashboard/stats', (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({ error: 'User email query parameter is required.' });
  }

  // Get login count
  db.get("SELECT count FROM login_counts WHERE LOWER(email) = LOWER(?)", [email], (err, logCountRow) => {
    const loginCount = logCountRow ? logCountRow.count : 0;

    // Get logs list
    db.all(
      "SELECT action, status, ip, timestamp FROM activity_logs WHERE LOWER(email) = LOWER(?) ORDER BY id DESC LIMIT 50",
      [email],
      (err, logs) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to fetch activity logs.' });
        }

        return res.status(200).json({
          success: true,
          loginCount,
          logs: logs || []
        });
      }
    );
  });
});

// Insert Activity Log row
app.post('/api/dashboard/log', (req, res) => {
  const { email, action, status, ip } = req.body;

  if (!email || !action || !status || !ip) {
    return res.status(400).json({ error: 'Missing log attributes (email, action, status, ip).' });
  }

  const timestamp = new Date().toISOString();
  db.run(
    "INSERT INTO activity_logs (email, action, status, ip, timestamp) VALUES (?, ?, ?, ?, ?)",
    [email, action, status, ip, timestamp],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to write activity log.' });
      }

      return res.status(201).json({ success: true, logId: this.lastID });
    }
  );
});

// Start listening
app.listen(PORT, () => {
  console.log(`NexusGate backend server listening on http://localhost:${PORT}`);
});
