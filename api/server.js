const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// Database Path Configuration (Use writable /tmp folder on Vercel)
const isVercel = process.env.VERCEL;
const dbDir = isVercel ? '/tmp' : path.resolve(__dirname, '..');

const paths = {
  users: path.join(dbDir, 'users_table.json'),
  login_counts: path.join(dbDir, 'login_counts_table.json'),
  activity_logs: path.join(dbDir, 'activity_logs_table.json')
};

// Helper to read/write JSON tables (Mimicking Relational Database Tables)
function readTable(tableName) {
  try {
    if (!fs.existsSync(paths[tableName])) {
      return [];
    }
    const data = fs.readFileSync(paths[tableName], 'utf8');
    return JSON.parse(data || '[]');
  } catch (e) {
    console.error(`Error reading table ${tableName}:`, e);
    return [];
  }
}

function writeTable(tableName, data) {
  try {
    fs.writeFileSync(paths[tableName], JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Error writing table ${tableName}:`, e);
  }
}

// Initialize and Seed Database
function initializeDatabase() {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const users = readTable('users');
  if (users.length === 0) {
    const adminPasswordHash = bcrypt.hashSync('Password123!', 10);
    const adminUser = {
      id: 1,
      name: "Nexus Admin",
      email: "admin@nexus.io",
      password: adminPasswordHash,
      joined: new Date().toISOString()
    };
    users.push(adminUser);
    writeTable('users', users);
    console.log("Seeded database with default user 'admin@nexus.io' (password: Password123!)");
  }
  console.log("JSON Database Tables verified & initialized.");
}

initializeDatabase();

// Mimicked DB Queries wrapper
const db = {
  get: (query, params, callback) => {
    try {
      if (query.includes("FROM users")) {
        const users = readTable('users');
        const email = params[0].toLowerCase();
        const user = users.find(u => u.email.toLowerCase() === email);
        callback(null, user);
      } else if (query.includes("FROM login_counts")) {
        const counts = readTable('login_counts');
        const email = params[0].toLowerCase();
        const row = counts.find(c => c.email.toLowerCase() === email);
        callback(null, row);
      } else {
        callback(new Error("Unknown query: " + query));
      }
    } catch (e) {
      callback(e);
    }
  },

  run: (query, params, callback) => {
    try {
      if (query.includes("INSERT INTO users")) {
        const users = readTable('users');
        const [name, email, password, joined] = params;
        const newUser = { id: users.length + 1, name, email, password, joined };
        users.push(newUser);
        writeTable('users', users);
        if (callback) callback(null);
      } else if (query.includes("login_counts")) {
        const counts = readTable('login_counts');
        const email = params[0];
        const index = counts.findIndex(c => c.email.toLowerCase() === email.toLowerCase());
        if (index > -1) {
          counts[index].count += 1;
        } else {
          counts.push({ email, count: 1 });
        }
        writeTable('login_counts', counts);
        if (callback) callback(null);
      } else if (query.includes("INSERT INTO activity_logs")) {
        const logs = readTable('activity_logs');
        const [email, action, status, ip, timestamp] = params;
        const newLog = { id: logs.length + 1, email, action, status, ip, timestamp };
        logs.push(newLog);
        writeTable('activity_logs', logs);
        if (callback) callback(null);
      } else {
        if (callback) callback(new Error("Unknown run query: " + query));
      }
    } catch (e) {
      if (callback) callback(e);
    }
  },

  all: (query, params, callback) => {
    try {
      if (query.includes("FROM activity_logs")) {
        const logs = readTable('activity_logs');
        const email = params[0].toLowerCase();
        const filtered = logs
          .filter(l => l.email.toLowerCase() === email)
          .sort((a, b) => b.id - a.id)
          .slice(0, 50);
        callback(null, filtered);
      } else {
        callback(new Error("Unknown all query: " + query));
      }
    } catch (e) {
      callback(e);
    }
  }
};

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

      return res.status(201).json({ success: true });
    }
  );
});

// Start listening (only when NOT running as serverless function on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`NexusGate backend server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
